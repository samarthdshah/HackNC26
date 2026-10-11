// Approval agent: prices the spend, works out who must sign off, and collects
// APPROVE/DENY by text, with nudges, escalation and delegation.
//
//   price ─▶ check_permission ─┬─▶ ask_approver ─▶ await_answer ─▶ on_answer ─┬─▶ ask_approver (next approver / escalate / delegate)
//                              │                                              ├─▶ await_answer  (nudge / unclear)
//                              └─▶ END (no sign-off needed)                   └─▶ END           (approved / denied)

import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { classifyReply } from "../../brain/classify.ts";
import { askJson } from "../../brain/gemini.ts";
import { getPerson } from "../../data/fixtures.ts";
import { env } from "../../env.ts";
import { postWarRoom, sendTo } from "../../messenger.ts";
import { firstName, isSensitive, isTeam, nameOf, resolveEntity } from "../../org/entities.ts";
import { learnDelegate } from "../../org/map.ts";
import { draft } from "../../tools/draft.ts";
import { checkPermission } from "../../tools/permission.ts";
import { agentBase, last, type Approval, type Resume, type Waiting } from "../state.ts";
import { recordHop } from "../hops.ts";
import { ev, fromBriefing, tell, vendorFor } from "./common.ts";

const ApprovalState = Annotation.Root({
  ...agentBase,
  amount: last<number>(0),
  approval: last<Approval | null>(null),
});
type S = typeof ApprovalState.State;

/** Re-price when an earlier step (e.g. RSVPs) changed the quantity. */
async function price(s: S) {
  const vendor = vendorFor(s.step);
  const headcount = fromBriefing(s.briefing, "headcount");
  if (!vendor || headcount === undefined) return { amount: s.step.amount_usd ?? 0 };
  const { amount_usd, working } = await askJson(
    `Vendor pricing: ${vendor.pricing}\nHeadcount: ${headcount}\nWhat is being bought: ${s.step.description}\nCompute the total in USD.`,
    z.object({ amount_usd: z.number(), working: z.string() }),
  );
  ev(s, "repriced", { from: s.step.amount_usd, to: amount_usd, headcount, working });
  return { amount: amount_usd };
}

function checkPermissionNode(s: S): Command {
  const r = checkPermission({ person: s.request.requester, action: s.step.description, amount_usd: s.amount });
  ev(s, "permission_checked", { amount_usd: s.amount, ...r });
  if (r.allowed) {
    return new Command({
      update: { result: { status: "done", summary: r.reason, data: { amount_usd: s.amount, approved_by: [] } } },
      goto: END,
    });
  }
  return new Command({
    update: { approval: { approvers: r.approvers, index: 0, reason: r.reason, amount_usd: s.amount, reminders: 0 } },
    goto: "ask_approver",
  });
}

async function askApprover(s: S) {
  const a = s.approval!;
  const approver = a.approvers[a.index];
  let { text } = await draft({
    to: approver,
    intent: `Ask them to approve or deny this spend for ${nameOf(s.request.requester)}. End with: Reply APPROVE or DENY.`,
    context: `Request: ${s.request.title}\nSpend: ${s.step.description}\nAmount: $${a.amount_usd}\nWhy them: ${a.reason}${s.briefing ? `\nContext:\n${s.briefing}` : ""}`,
  });
  if (!/APPROVE/i.test(text)) text += " Reply APPROVE or DENY.";
  await sendTo(approver, text, s.request.id);
  ev(s, "approval_requested", { approver, amount_usd: a.amount_usd, reason: a.reason });
  if (!a.ask) await tell(s, `$${a.amount_usd} needs sign-off from ${nameOf(approver)}. ${a.reason}`);
  await postWarRoom(`🟡 ${s.request.title}: waiting on ${nameOf(approver)} to approve $${a.amount_usd}`, s.request.id, isSensitive(s.request.task_type));
  return { approval: { ...a, ask: text } };
}

function awaitAnswer(s: S) {
  const a = s.approval!;
  const incoming = interrupt<Waiting, Resume>({
    kind: "approval",
    waitingOn: [a.approvers[a.index]],
    summary: `Approve $${a.amount_usd} for ${nameOf(s.request.requester)}: ${s.step.description}`,
    ask: a.ask,
  });
  return { incoming };
}

async function onAnswer(s: S): Promise<Command> {
  const a = s.approval!;
  const approver = a.approvers[a.index];
  const msg = s.incoming!;

  if (msg.type === "timeout") {
    if (a.reminders >= env.maxReminders) {
      const boss = getPerson(approver)?.manager_id ?? approver;
      ev(s, "escalated", { from: approver, to: boss });
      recordHop(s.request.id, s.request.requester, approver, "forwarded", { note: "no reply to approval, escalated" });
      await tell(s, `${firstName(approver)} hasn't answered, so I'm escalating to ${nameOf(boss)}.`);
      const approvers = a.approvers.map((x, i) => (i === a.index ? boss : x));
      return new Command({ update: { approval: { ...a, approvers, reminders: 0 } }, goto: "ask_approver" });
    }
    await sendTo(approver, `Nudge: still need your APPROVE or DENY on ${s.request.title} ($${a.amount_usd}).`, s.request.id);
    ev(s, "reminder_sent", { to: approver });
    return new Command({ update: { approval: { ...a, reminders: a.reminders + 1 } }, goto: "await_answer" });
  }
  if (msg.type !== "reply") return new Command({ goto: "await_answer" });

  const verdict = await classifyReply(msg.text, a.ask ?? "", true);
  if (verdict.kind === "done" || verdict.kind === "accept") {
    ev(s, "approved", { approver, amount_usd: a.amount_usd });
    recordHop(s.request.id, s.request.requester, approver, "forwarded", { note: `approved $${a.amount_usd}` });
    if (a.index + 1 < a.approvers.length) {
      await tell(s, `${firstName(approver)} approved. Now asking ${nameOf(a.approvers[a.index + 1])}.`);
      return new Command({ update: { verdict, approval: { ...a, index: a.index + 1, reminders: 0 } }, goto: "ask_approver" });
    }
    const by = a.approvers.slice(0, a.index + 1);
    return new Command({
      update: {
        verdict,
        result: {
          status: "done",
          owner: approver,
          summary: `${by.map(firstName).join(" and ")} approved $${a.amount_usd}`,
          data: { amount_usd: a.amount_usd, approved_by: by },
        },
      },
      goto: END,
    });
  }
  if (verdict.kind === "deny") {
    ev(s, "denied", { approver, note: verdict.note });
    recordHop(s.request.id, s.request.requester, approver, "handled", { note: `denied $${a.amount_usd}` });
    return new Command({
      update: { verdict, result: { status: "denied", owner: approver, summary: `${firstName(approver)} denied: ${msg.text}` } },
      goto: END,
    });
  }
  const delegate = verdict.kind === "delegate" || verdict.kind === "redirect" ? resolveEntity(verdict.target) : undefined;
  if (delegate && !isTeam(delegate)) {
    learnDelegate(approver, delegate, "purchase_approval", verdict.until, s.request.id);
    ev(s, "delegated", { from: approver, to: delegate, until: verdict.until });
    recordHop(s.request.id, s.request.requester, approver, "delegated", { redirect_to: delegate, note: msg.text });
    const approvers = a.approvers.map((x, i) => (i === a.index ? delegate : x));
    return new Command({ update: { verdict, approval: { ...a, approvers, reminders: 0 } }, goto: "ask_approver" });
  }
  await sendTo(approver, "Sorry, I just need a clear APPROVE or DENY on this one.", s.request.id);
  return new Command({ update: { verdict }, goto: "await_answer" });
}

export const buildApprovalAgent = () =>
  new StateGraph(ApprovalState)
    .addNode("price", price)
    .addNode("check_permission", checkPermissionNode, { ends: ["ask_approver", END] })
    .addNode("ask_approver", askApprover)
    .addNode("await_answer", awaitAnswer)
    .addNode("on_answer", onAnswer, { ends: ["ask_approver", "await_answer", END] })
    .addEdge(START, "price")
    .addEdge("price", "check_permission")
    .addEdge("ask_approver", "await_answer")
    .addEdge("await_answer", "on_answer");
