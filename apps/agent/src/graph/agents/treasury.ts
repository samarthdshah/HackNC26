// Treasury agent: moves money for a payment step.
//
//   guard ─▶ execute (Gemini tool loop) ─▶ verify ─▶ receipt ─▶ END
//
// guard fixes the ceiling (the approved amount) before any model runs; the tools
// enforce it again, refuse unapproved vendors and unsupported rails, and are
// idempotent per step so a retry can never pay twice.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { logFile } from "../../logs.ts";
import { Annotation, Command, END, START, StateGraph } from "@langchain/langgraph";
import type { ToolIO } from "@wayfinder/shared";
import { z } from "zod";
import { toolLoop, type LoopTool } from "../../brain/gemini.ts";
import { budgets, departments, getPerson, vendors } from "../../data/fixtures.ts";
import { postWarRoom } from "../../messenger.ts";
import { billVendor, transferBetweenBudgets } from "../../money/nessie.ts";
import { payVendor } from "../../money/solana.ts";
import { isSensitive, nameOf } from "../../org/entities.ts";
import { checkPermission } from "../../tools/permission.ts";
import { agentBase, last } from "../state.ts";
import { ev, fromBriefing, tell, vendorFor } from "./common.ts";

type Payment = ToolIO["pay"]["output"] & { amount_usd: number; to: string; memo: string; explorer_url?: string };

const TreasuryState = Annotation.Root({
  ...agentBase,
  ceiling: last<number>(0),
  payment: last<Payment | null>(null),
  notes: last<string>(""),
});
type S = typeof TreasuryState.State;

// Idempotency: one payment per request step, ever.
const paidFile = logFile("payments.json");
const paid: Record<string, Payment> = existsSync(paidFile) ? JSON.parse(readFileSync(paidFile, "utf8")) : {};
const record = (key: string, p: Payment) => {
  paid[key] = p;
  writeFileSync(paidFile, JSON.stringify(paid, null, 1));
};

function guard(s: S): Command {
  const approved = fromBriefing(s.briefing, "amount_usd");
  const selfOk = checkPermission({ person: s.request.requester, action: s.step.description, amount_usd: s.step.amount_usd }).allowed;
  const ceiling = approved ?? (selfOk ? (s.step.amount_usd ?? 0) : 0);
  if (ceiling <= 0) {
    return new Command({
      update: { result: { status: "failed", summary: "No approved amount to pay against. An approval step must come first." } },
      goto: END,
    });
  }
  return new Command({ update: { ceiling }, goto: "execute" });
}

function tools(s: S, key: string, onPaid: (p: Payment) => void): LoopTool[] {
  const requesterDept = getPerson(s.request.requester)?.department_id ?? "";
  const capCheck = (amount: number) => {
    if (paid[key]) throw new Error(`Already paid for this step: ${paid[key].tx_id}`);
    if (amount > s.ceiling + 0.01) throw new Error(`Amount $${amount} exceeds the approved $${s.ceiling}`);
  };
  return [
    {
      name: "vendor_info",
      description: "Look up a vendor: approval status, pricing, accepted payment methods.",
      parameters: z.object({ vendor_id: z.string() }),
      run: ({ vendor_id }) => vendors.find((v) => v.id === vendor_id) ?? { error: "unknown vendor" },
    },
    {
      name: "budget_lines",
      description: "Budget lines (remaining dollars) for a department.",
      parameters: z.object({ department_id: z.string() }),
      run: ({ department_id }) =>
        budgets.filter((b) => b.department_id === department_id).map((b) => ({ ...b, remaining_usd: b.amount_usd - b.spent_usd })),
    },
    {
      name: "pay_vendor_solana",
      description: "Pay an approved vendor that accepts solana_devnet. Sends SOL on devnet with a memo receipt.",
      parameters: z.object({ vendor_id: z.string(), amount_usd: z.number(), memo: z.string() }),
      run: async ({ vendor_id, amount_usd, memo }) => {
        const v = vendors.find((x) => x.id === vendor_id);
        if (!v?.approved) throw new Error("Vendor is not approved (POL-SPEND-2)");
        if (!v.payment_methods.includes("solana_devnet")) throw new Error(`${v.name} does not accept Solana`);
        capCheck(Number(amount_usd));
        const memoText = `${s.request.id}/${s.step.id} ${String(memo)}`;
        const r = await payVendor(v.id, Number(amount_usd), memoText);
        const p: Payment = { tx_id: r.signature, rail: `solana devnet (${r.sol} SOL)`, receipt_url: r.explorer_url, explorer_url: r.explorer_url, amount_usd: Number(amount_usd), to: v.name, memo: memoText };
        onPaid(p);
        return p;
      },
    },
    {
      name: "bill_vendor_nessie",
      description: "Queue payment to an approved invoice/card vendor as a bill on the requester's department account (Nessie).",
      parameters: z.object({ vendor_id: z.string(), amount_usd: z.number(), memo: z.string() }),
      run: async ({ vendor_id, amount_usd, memo }) => {
        const v = vendors.find((x) => x.id === vendor_id);
        if (!v?.approved) throw new Error("Vendor is not approved (POL-SPEND-2)");
        if (!v.payment_methods.some((m) => m === "invoice" || m === "card")) throw new Error(`${v.name} takes neither invoice nor card`);
        capCheck(Number(amount_usd));
        const r = await billVendor(requesterDept, v.name, Number(amount_usd), String(memo));
        const p: Payment = { ...r, amount_usd: Number(amount_usd), to: v.name, memo: String(memo) };
        onPaid(p);
        return p;
      },
    },
    {
      name: "transfer_between_budgets",
      description: "Move money from the requester's department budget to another department (Nessie transfer).",
      parameters: z.object({ to_department: z.string(), amount_usd: z.number(), memo: z.string() }),
      run: async ({ to_department, amount_usd, memo }) => {
        if (!departments.some((d) => d.id === to_department)) throw new Error("unknown department");
        capCheck(Number(amount_usd));
        const r = await transferBetweenBudgets(requesterDept, String(to_department), Number(amount_usd), String(memo));
        const p: Payment = { ...r, amount_usd: Number(amount_usd), to: nameOf(String(to_department)), memo: String(memo) };
        onPaid(p);
        return p;
      },
    },
  ];
}

async function execute(s: S) {
  const key = `${s.request.id}/${s.step.id}`;
  if (paid[key]) return { payment: paid[key], notes: "already paid" };
  const box: { payment?: Payment } = {};
  const system = `You are the treasury agent. Execute exactly one payment for this step, then reply with one sentence.
Use vendor_info first when a vendor is involved and pick the rail the vendor accepts (prefer solana_devnet when offered).
Never pay more than the approved ceiling of $${s.ceiling}. If something blocks payment, explain it instead of paying.`;
  const prompt = [
    `Request: ${s.request.title} for ${nameOf(s.request.requester)}`,
    `Step: ${s.step.description}`,
    vendorFor(s.step) && `Vendor id: ${vendorFor(s.step)!.id}`,
    s.step.to_department && `Receiving department: ${s.step.to_department}`,
    `Approved ceiling: $${s.ceiling}`,
    s.briefing && `Earlier steps:\n${s.briefing}`,
  ]
    .filter(Boolean)
    .join("\n");
  const { text, calls } = await toolLoop(prompt, tools(s, key, (p) => (box.payment = p)), system);
  if (box.payment) record(key, box.payment);
  ev(s, "treasury_reasoning", { calls: calls.map((c) => c.name), note: text });
  return { payment: box.payment ?? null, notes: text };
}

function verify(s: S): Command {
  if (!s.payment) {
    return new Command({ update: { result: { status: "failed", summary: `Payment not made: ${s.notes}` } }, goto: END });
  }
  return new Command({ goto: "receipt" });
}

async function receipt(s: S) {
  const p = s.payment!;
  ev(s, "payment_sent", { ...p });
  const link = p.explorer_url ? ` Receipt: ${p.explorer_url}` : "";
  const sim = p.simulated ? " (Nessie was unreachable, so this is on the local ledger for now)" : "";
  await tell(s, `💸 Paid ${p.to} $${p.amount_usd} via ${p.rail}.${link}${sim}`);
  await postWarRoom(`💸 ${s.request.title}: $${p.amount_usd} → ${p.to} (${p.rail})`, s.request.id, isSensitive(s.request.task_type));
  return {
    result: {
      status: "done" as const,
      summary: `Paid ${p.to} $${p.amount_usd} via ${p.rail}`,
      data: { tx_id: p.tx_id, rail: p.rail, paid_usd: p.amount_usd, explorer_url: p.explorer_url, simulated: Boolean(p.simulated) },
    },
  };
}

export const buildTreasuryAgent = () =>
  new StateGraph(TreasuryState)
    .addNode("guard", guard, { ends: ["execute", END] })
    .addNode("execute", execute)
    .addNode("verify", verify, { ends: ["receipt", END] })
    .addNode("receipt", receipt)
    .addEdge(START, "guard")
    .addEdge("execute", "verify")
    .addEdge("receipt", END);
