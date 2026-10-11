// Capital One Nessie sandbox as the internal treasury. Each department's budget
// line is a Nessie checking account under one "Photon Treasury" customer.
// Internal moves are transfers; invoice/card vendors become bills.
// When Nessie is unreachable, writes go to a local ledger and say so (simulated: true).

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { logFile } from "../logs.ts";
import { budgets, company, departments } from "../data/fixtures.ts";
import { env, required } from "../env.ts";

export interface NessieCustomer {
  _id: string;
  first_name: string;
  last_name: string;
}

export interface NessieAccount {
  _id: string;
  type: "Checking" | "Savings" | "Credit Card";
  nickname: string;
  balance: number;
  customer_id: string;
}

async function nessie<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, env.nessie.baseUrl);
  url.searchParams.set("key", required("NESSIE_API_KEY"));
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Nessie ${init?.method ?? "GET"} ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown) => nessie<T>(path, { method: "POST", body: JSON.stringify(body) });

export const listCustomers = () => nessie<NessieCustomer[]>("/customers");
export const listAccounts = () => nessie<NessieAccount[]>("/accounts");

// ── department accounts ─────────────────────────────────────────────────────

const stateFile = logFile("nessie.json");
const ledgerFile = logFile("ledger.jsonl");
type Ids = { customer?: string; accounts: Record<string, string> };
let ids: Ids = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { accounts: {} };

async function accountFor(departmentId: string): Promise<string> {
  if (ids.accounts[departmentId]) return ids.accounts[departmentId];
  if (!ids.customer) {
    const res = await post<{ objectCreated: { _id: string } }>("/customers", {
      first_name: company.name,
      last_name: "Treasury",
      address: { street_number: "1", street_name: "Main St", city: "Durham", state: "NC", zip: "27701" },
    });
    ids.customer = res.objectCreated._id;
  }
  const dept = departments.find((d) => d.id === departmentId);
  const remaining = budgets
    .filter((b) => b.department_id === departmentId)
    .reduce((sum, b) => sum + b.amount_usd - b.spent_usd, 0);
  const res = await post<{ objectCreated: { _id: string } }>(`/customers/${ids.customer}/accounts`, {
    type: "Checking",
    nickname: `${dept?.name ?? departmentId} budget`,
    rewards: 0,
    balance: Math.round(remaining),
  });
  ids.accounts[departmentId] = res.objectCreated._id;
  writeFileSync(stateFile, JSON.stringify(ids, null, 1));
  return ids.accounts[departmentId];
}

function offline(kind: string, entry: Record<string, unknown>, err: unknown) {
  const id = `ledger_${Date.now().toString(36)}`;
  appendFileSync(ledgerFile, JSON.stringify({ id, kind, ts: new Date().toISOString(), ...entry, error: String(err) }) + "\n");
  return { tx_id: id, rail: "ledger (Nessie offline)", simulated: true as const };
}

/** Move money between two departments' budget lines. */
export async function transferBetweenBudgets(fromDept: string, toDept: string, amountUsd: number, description: string) {
  try {
    const [from, to] = [await accountFor(fromDept), await accountFor(toDept)];
    // This Nessie's transfers are one-sided (no payee field), so the money moves as
    // a transfer out of the source account plus a deposit into the destination.
    const day = new Date().toISOString().slice(0, 10);
    const res = await post<{ objectCreated: { _id: string } }>(`/accounts/${from}/transfers`, {
      transaction_date: day,
      status: "completed",
      amount: amountUsd,
      description: `To ${toDept}: ${description}`.slice(0, 120),
    });
    await post(`/accounts/${to}/deposits`, {
      medium: "balance",
      transaction_date: day,
      status: "completed",
      amount: amountUsd,
      description: `From ${fromDept}: ${description}`.slice(0, 120),
    });
    return { tx_id: res.objectCreated._id, rail: "nessie transfer", simulated: false as const };
  } catch (err) {
    return offline("transfer", { fromDept, toDept, amountUsd, description }, err);
  }
}

/** Queue an invoice/card vendor payment as a bill on the department's account. */
export async function billVendor(departmentId: string, vendorName: string, amountUsd: number, description: string) {
  try {
    const account = await accountFor(departmentId);
    const today = new Date().toISOString().slice(0, 10);
    // This Nessie stores a bill without recurring_date / upcoming_payment_date, then can't
    // read it back, which breaks every bills read on the account. Always send both.
    const res = await post<{ objectCreated: { _id: string } }>(`/accounts/${account}/bills`, {
      status: "pending",
      payee: vendorName,
      nickname: description.slice(0, 60),
      payment_date: today,
      recurring_date: Number(today.slice(8, 10)),
      upcoming_payment_date: today,
      payment_amount: amountUsd,
    });
    return { tx_id: res.objectCreated._id, rail: "nessie bill", simulated: false as const };
  } catch (err) {
    return offline("bill", { departmentId, vendorName, amountUsd, description }, err);
  }
}

export function resetNessie() {
  ids = { accounts: {} };
}
