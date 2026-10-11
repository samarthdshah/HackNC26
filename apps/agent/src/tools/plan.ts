// plan: two agents. The planner proposes a dependency graph of steps, each
// assigned to a specialist; the policy critic reviews it against the handbook.
// The orchestrator loops planner -> critic until approved (max 2 revisions).

import type { PlanStep, ToolIO } from "@wayfinder/shared";
import { z } from "zod";
import { askJson } from "../brain/gemini.ts";
import { departments, getPerson, policies, rooms, vendors } from "../data/fixtures.ts";
import { describePerson } from "../org/entities.ts";
import { taskTypes } from "../org/map.ts";

type In = ToolIO["plan"]["input"];

const StepSchema = z.object({
  id: z.string().describe("s1, s2, ..."),
  kind: z
    .enum(["action", "approval", "payment", "call", "rsvp", "room"])
    .describe(
      "action: a person must do it. approval: spend sign-off. payment: money moves (vendor or between budgets). " +
        "call: phone a vendor to place or confirm an order. rsvp: collect yes/no from a group for a headcount. " +
          "room: make sure a room is free for a time (frees unused booked time); Workplace still books it.",
    ),
  task_type: z.string(),
  description: z.string().describe("One imperative sentence naming who it is for"),
  depends_on: z.array(z.string()).describe("Ids of steps that must finish first. Empty if it can start now."),
  amount_usd: z.number().optional(),
  vendor_id: z.string().optional(),
  to_department: z.string().optional().describe("Internal transfers: the department id receiving money"),
  audience: z.string().optional().describe("rsvp: a team name or comma-separated first names"),
});

const PlanSchema = z.object({ steps: z.array(StepSchema).min(1).max(6) });

const CritiqueSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.string()).describe("Concrete problems with policy ids, empty when approved"),
});

const PLANNER = `You are the planning agent for Wayfinder, an internal coordinator. Turn the goal into the
fewest steps, each run by one specialist, as a dependency graph (steps without dependencies run in parallel).
- approval steps exist ONLY for spending money. One approval step per spend: it works out every required
  approver itself (manager, budget owner, VP, Finance), so never split approvers into several steps.
- Access requests are a single action step: the owning team's lead or delegate approves and grants it there.
- Spending: the approval step comes before the call/payment that commits money; put the amount on both,
  priced from the vendor list. If the amount depends on a headcount, depend on the rsvp step and estimate.
- Vendor orders: a call step to place the order, then a payment step (pay vendor) after approval.
- Fixes and favours from other teams: one action step.
- Meetings or events needing a room: a room step (after any rsvp, so it knows the headcount), then an action
  step for Workplace to book it (task_type room_booking), depending on the room step. Food needs The Commons.
- Moving budget between departments: approval then payment with to_department.
- Set vendor_id on every approval, call and payment step that involves a vendor.
- Never add steps the agent does itself (lookups, telling the requester).
- task_type must be one of the allowed values; vendor_id and to_department must be real ids.`;

const CRITIC = `You are the policy critic for Wayfinder. Check a proposed plan against the handbook.
One approval step per spend is correct: at run time it routes to every approver the policy requires
(manager, budget owner, VP, Controller), so never ask for separate approval steps per approver or department.
Check for:
missing or misplaced approvals (POL-SPEND-1), unapproved vendors (POL-SPEND-2), caps such as welcome
lunch limits (POL-ONB-2), wrong owners (POL-DATA-1, POL-IT-1), impossible dependencies or cycles,
and pointless steps. Approve if it is good enough to execute; do not nitpick wording.`;

function grounding(input: In): string {
  const person = getPerson(input.requester);
  return [
    `Goal: ${input.goal}`,
    `Requester: ${person ? describePerson(person) : input.requester}`,
    input.task_type && `Likely task type: ${input.task_type}`,
    input.amount_usd && `Stated amount: $${input.amount_usd}`,
    `Allowed task_type values: ${taskTypes().join(", ")}`,
    `Rooms: ${rooms.map((r) => `${r.id} ${r.name} (${r.capacity} seats; ${r.features.join(", ")})`).join("; ")}`,
    `Departments: ${departments.map((d) => `${d.id} (${d.name})`).join(", ")}`,
    `Vendors:\n${vendors.map((v) => `${v.id} ${v.name} [${v.approved ? "approved" : "NOT approved"}] ${v.category}: ${v.pricing} Pays by ${v.payment_methods.join("/")}`).join("\n")}`,
    `Policy handbook:\n${policies.map((p) => `[${p.id}] ${p.title}: ${p.text}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function proposePlan(input: In, feedback: string[] = [], previous?: PlanStep[]): Promise<PlanStep[]> {
  const revise = feedback.length
    ? `\n\nYour previous plan:\n${JSON.stringify(previous)}\n\nThe policy critic found:\n- ${feedback.join("\n- ")}\nRevise the plan.`
    : "";
  const { steps: proposed } = await askJson(grounding(input) + revise, PlanSchema, PLANNER);
  const steps = mergeApprovals(proposed);
  const allowed = taskTypes();
  const ids = new Set(steps.map((s) => s.id));
  return steps.map((s) => ({
    ...s,
    task_type: allowed.includes(s.task_type) ? s.task_type : (input.task_type ?? s.task_type),
    depends_on: s.depends_on.filter((d) => ids.has(d) && d !== s.id),
    vendor_id: vendors.some((v) => v.id === s.vendor_id) ? s.vendor_id : undefined,
  }));
}

/**
 * One approval per spend: approval steps for the same amount collapse into the
 * first one (the approval agent finds every required approver itself), and
 * dependencies on the dropped steps point at the survivor.
 */
function mergeApprovals<T extends z.infer<typeof StepSchema>>(steps: T[]): T[] {
  const keep = new Map<string, string>(); // dropped id -> kept id
  const firstByAmount = new Map<number, string>();
  for (const st of steps) {
    if (st.kind !== "approval" || st.amount_usd === undefined) continue;
    const first = firstByAmount.get(st.amount_usd);
    if (first) keep.set(st.id, first);
    else firstByAmount.set(st.amount_usd, st.id);
  }
  return steps
    .filter((st) => !keep.has(st.id))
    .map((st) => ({ ...st, depends_on: [...new Set(st.depends_on.map((d) => keep.get(d) ?? d))] }));
}

export async function critiquePlan(input: In, steps: PlanStep[]) {
  return askJson(`${grounding(input)}\n\nProposed plan:\n${JSON.stringify(steps, null, 1)}`, CritiqueSchema, CRITIC);
}
