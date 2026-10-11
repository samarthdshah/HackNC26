// How stored records show on the pages: hop outcome → Currents verdict, event → transaction row.

import type { Event, HopOutcome, TxKind, Verdict } from "@wayfinder/shared";
import { firstName, taskLabel } from "./format";

export function verdictOf(outcome: HopOutcome, approved: boolean): Verdict {
  switch (outcome) {
    case "bounced": return "redirect";
    case "delegated": return "delegate";
    case "forwarded": return "forward";
    case "handled": return approved ? "approve" : "answer";
    default: return "pending";
  }
}

const HOP_KIND: Record<string, TxKind> = { bounced: "msg", delegated: "msg", forwarded: "route", handled: "approve" };

/**
 * One event → one transaction row, or null for internal bookkeeping the page hides.
 * `name(id)` gives a display name; `me` marks rows the viewer typed on the website.
 */
export function txOf(e: Event, name: (id: string) => string, me: string): { from: string; kind: TxKind; text: string } | null {
  const p = e.payload as Record<string, any>;
  const first = (id: unknown) => (typeof id !== "string" ? "someone" : id.startsWith("p_") ? firstName(name(id)) : name(id));
  const money = (n: unknown) => (typeof n === "number" ? `$${n.toLocaleString("en-US")}` : "");
  switch (e.type) {
    case "request_created": return { from: e.actor, kind: "msg", text: String(p.goal ?? p.title ?? "") };
    case "reply_in": return { from: e.actor, kind: p.platform === "web" && e.actor === me ? "you" : "msg", text: String(p.text ?? "") };
    case "message_out":
      if (p.kind === "voice") return { from: "wf", kind: "msg", text: `🔊 Voice note to ${first(p.to)}: ${p.caption ?? ""}` };
      return { from: "wf", kind: "msg", text: p.to ? `→ ${first(p.to)}: ${p.text ?? ""}` : String(p.text ?? "") };
    case "routed": {
      const chain = Array.isArray(p.chain) ? p.chain.map((c: string) => name(c)).join(" → ") : name(String(p.owner ?? ""));
      return { from: "wf", kind: "route", text: `Routing to ${chain}.` };
    }
    case "hop": return { from: String(p.to ?? e.actor), kind: HOP_KIND[p.outcome] ?? "msg", text: String(p.note ?? p.outcome ?? "") };
    case "redirected": return { from: "wf", kind: "learn", text: `Learned: ${taskLabel(String(p.task_type ?? "this"))} goes to ${name(String(p.to ?? ""))}, not ${name(String(p.from ?? ""))}.` };
    case "delegated": return { from: "wf", kind: "learn", text: `${first(p.from)} is out, so ${first(p.to)} covers${p.until ? ` until ${String(p.until).slice(0, 10)}` : ""}.` };
    case "darwin_hint": return { from: "wf", kind: "learn", text: `Darwin rule: ${p.reason ?? "route directly"}.` };
    case "booking_released": return { from: "wf", kind: "learn", text: `Released ${first(p.booked_by)}'s unused room time (${String(p.from ?? "").slice(11, 16)}–${String(p.to ?? "").slice(11, 16)}).` };
    case "approval_requested": return { from: "wf", kind: "pending", text: `Asked ${first(p.approver)} to approve ${money(p.amount_usd)} by text.`.replace(" approve  by", " approve by") };
    case "reminder_sent": return { from: "wf", kind: "pending", text: `Reminded ${Array.isArray(p.to) ? p.to.map(first).join(", ") : first(p.to)}.` };
    case "escalated": return { from: "wf", kind: "pending", text: `No reply from ${first(p.from)}, escalated to ${first(p.to)}.` };
    case "request_stuck": return { from: "wf", kind: "pending", text: "Stuck: AVATAR needs a hand to finish this." };
    case "approved": return { from: String(p.approver ?? e.actor), kind: "approve", text: `Approved ${money(p.amount_usd)}`.trim() + "." };
    case "request_resolved": return { from: "wf", kind: "approve", text: "Resolved." };
    case "denied": return { from: String(p.approver ?? p.by ?? e.actor), kind: "deny", text: `Declined${p.note ? `: ${p.note}` : "."}` };
    case "request_denied": return { from: "wf", kind: "deny", text: "Request denied." };
    case "payment_sent": {
      const rail = p.rail === "solana" ? "Solana devnet" : p.rail === "nessie" ? "Nessie" : String(p.rail ?? "");
      return { from: "wf", kind: "pay", text: `Paid ${money(p.amount_usd)} to ${name(String(p.to ?? ""))} via ${rail}${p.simulated ? " (local ledger)" : ""}.` };
    }
    case "rsvp_opened": return { from: "wf", kind: "route", text: `Asked ${Array.isArray(p.invitees) ? p.invitees.length : "the group"} people who's coming.` };
    case "rsvp_received": return { from: String(p.from ?? e.actor), kind: "msg", text: String(p.answer ?? (p.yes ? "yes" : "no")) };
    case "rsvp_closed": return { from: "wf", kind: "route", text: `Headcount: ${p.headcount ?? 0}.` };
    case "call_started": return { from: "wf", kind: "route", text: `Calling ${name(String(p.vendor ?? ""))}…` };
    case "call_ended": return { from: "wf", kind: "route", text: `Call with ${name(String(p.vendor ?? ""))} ended${p.live === false ? " (role-played)" : ""}.` };
    case "room_checked": return { from: "wf", kind: "route", text: `Checked ${name(String(p.room_id ?? ""))}${Array.isArray(p.conflicts) && p.conflicts.length ? `: ${p.conflicts.length} conflict(s)` : ": free"}.` };
    case "plan_created": { const n = Array.isArray(p.steps) ? p.steps.length : 0; return { from: "wf", kind: "route", text: `Plan: ${n} step${n === 1 ? "" : "s"}.` }; }
    case "intro_sent": return { from: "wf", kind: "route", text: `Introduced ${first(p.a)} and ${first(p.b)} about ${p.topic}.` };
    default: return null; // step_done (the hop row says it), agent_*, handoff, plan_proposed/reviewed, permission_checked, treasury_reasoning, war_room_post, ...
  }
}
