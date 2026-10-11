// check_permission: who has to sign off before `person` spends money.
// Encodes POL-SPEND-1, POL-SPEND-2 (budget transfers) and POL-OOO-1 over the fixtures. Lane C will back this
// with Snowflake roles; the signature stays the same.

import type { ToolIO } from "@wayfinder/shared";
import { budgets, getDepartment, getPerson, people } from "../data/fixtures.ts";

type In = ToolIO["check_permission"]["input"];
type Out = ToolIO["check_permission"]["output"];

const VP = () => people.find((p) => p.access_role === "vp")?.id;
const CONTROLLER = () => people.find((p) => p.role === "Controller")?.id;

/** Swap anyone who is out for their delegate (POL-OOO-1). */
function available(id: string): string {
  const p = getPerson(id);
  return p?.status === "out" && p.delegate_id ? p.delegate_id : id;
}

/** Budget line the spend is charged to: requester's team, best category match. */
function budgetFor(departmentId: string, action: string) {
  const lines = budgets.filter((b) => b.department_id === departmentId);
  const words = action.toLowerCase();
  return lines.find((b) => b.category.split(" ").some((w) => w.length > 3 && words.includes(w))) ?? lines[0];
}

export function checkPermission({ person, action, amount_usd, to_department }: In): Out {
  const requester = getPerson(person);
  if (!requester) return { allowed: false, approvers: [], reason: `unknown person ${person}` };
  if (!amount_usd || amount_usd <= 0) return { allowed: true, approvers: [], reason: "No spend involved." };

  const budget = budgetFor(requester.department_id, action);
  const remaining = budget ? budget.amount_usd - budget.spent_usd : undefined;
  const head = getDepartment(budget?.department_id ?? requester.department_id)?.head_id;

  let approvers: string[];
  let reason: string;
  const target = to_department && to_department !== requester.department_id ? budgetFor(to_department, action) : undefined;
  if (target) {
    // POL-SPEND-2: moving money between budget lines needs both budget owners, whatever the amount.
    approvers = [budget?.owner_id, target.owner_id].filter((x): x is string => Boolean(x));
    reason = `Transfers between budget lines need both budget owners (POL-SPEND-2): ${budget?.category ?? "source"} and ${target.category}.`;
  } else if (amount_usd < 500) {
    approvers = requester.manager_id ? [requester.manager_id] : [];
    reason = `Under $500, so ${requester.name.split(" ")[0]}'s manager approves (POL-SPEND-1).`;
  } else if (amount_usd < 5000) {
    approvers = head ? [head] : [];
    reason = "$500 to $4,999 needs the department head who owns the budget (POL-SPEND-1).";
  } else {
    approvers = [VP(), CONTROLLER()].filter((x): x is string => Boolean(x));
    reason = "$5,000 or more needs the VP and the Controller (POL-SPEND-1).";
  }

  if (remaining !== undefined && amount_usd > remaining) {
    const controller = CONTROLLER();
    if (controller && !approvers.includes(controller)) approvers.push(controller);
    reason += ` It exceeds the ${budget!.category} line's remaining $${remaining}, so Finance signs off too.`;
  }

  // Nobody approves their own spend.
  approvers = [...new Set(approvers.filter((a) => a !== person).map(available))];
  // Someone still has to sign off, unless the requester is the VP.
  if (approvers.length === 0 && requester.access_role !== "vp") {
    approvers = [VP()].filter((x): x is string => Boolean(x));
  }

  return {
    allowed: approvers.length === 0,
    approvers,
    reason,
    ...(budget && { budget_id: budget.id, remaining_usd: remaining }),
  };
}
