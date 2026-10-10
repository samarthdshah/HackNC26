// RSVP agent: opens a group thread and collects yes/no for a headcount.
//
//   resolve_invitees ─▶ invite ─▶ await_rsvps ─▶ on_rsvp ─┬─▶ await_rsvps (more answers due / first nudge)
//                                                         └─▶ finalize ─▶ END (everyone answered or time's up)

import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { askJson } from "../../brain/gemini.ts";
import { people } from "../../data/fixtures.ts";
import { openGroup, sendTo } from "../../messenger.ts";
import { firstName, isTeam, nameOf, resolveEntity } from "../../org/entities.ts";
import { agentBase, last, type Resume, type Waiting } from "../state.ts";
import { ev, tell } from "./common.ts";

type Answer = "yes" | "no" | "maybe";

const RsvpState = Annotation.Root({
  ...agentBase,
  invitees: last<string[]>([]),
  answers: last<Record<string, Answer>>({}),
  groupId: last<string>(""),
  nudges: last<number>(0),
});
type S = typeof RsvpState.State;

// Group handles can't live in checkpointed state, so keep them per thread here.
const groups = new Map<string, Awaited<ReturnType<typeof openGroup>>>();
const groupKey = (s: S) => `${s.request.id}/${s.step.id}`;

function resolveInvitees(s: S): Command {
  const raw = s.step.audience ?? "";
  const ids = new Set<string>();
  for (const part of raw.split(/,|\band\b/)) {
    const id = resolveEntity(part);
    if (!id) continue;
    if (isTeam(id)) people.filter((p) => p.department_id === id && p.status === "active").forEach((p) => ids.add(p.id));
    else ids.add(id);
  }
  ids.delete(s.request.requester);
  if (ids.size === 0) {
    return new Command({ update: { result: { status: "failed", summary: `Couldn't work out who to invite from "${raw}"` } }, goto: END });
  }
  // The organiser counts as a yes.
  return new Command({ update: { invitees: [...ids], answers: { [s.request.requester]: "yes" } }, goto: "invite" });
}

async function invite(s: S) {
  const title = s.request.title ?? "RSVP";
  const group = await openGroup([s.request.requester, ...s.invitees], title, s.request.id);
  groups.set(groupKey(s), group);
  await group.send(`👋 ${nameOf(s.request.requester)} is organising: ${s.step.description.replace(/\.$/, "")}. Reply YES or NO so we can get a headcount.`);
  ev(s, "rsvp_opened", { invitees: s.invitees, group: group.id });
  return { groupId: group.id };
}

function awaitRsvps(s: S) {
  const pending = s.invitees.filter((p) => !s.answers[p]);
  const incoming = interrupt<Waiting, Resume>({
    kind: "rsvp",
    waitingOn: pending,
    summary: `RSVP: ${s.step.description}`,
    ask: "Reply YES or NO",
  });
  return { incoming };
}

async function readAnswer(text: string): Promise<Answer> {
  const t = text.trim().toLowerCase();
  if (/^(yes|y|yep|yeah|in|count me in|i'?m in|sure)\b/.test(t)) return "yes";
  if (/^(no|n|nope|can'?t|out|pass)\b/.test(t)) return "no";
  const { answer } = await askJson(`RSVP reply: "${text}"`, z.object({ answer: z.enum(["yes", "no", "maybe"]) }));
  return answer;
}

async function onRsvp(s: S): Promise<Command> {
  const msg = s.incoming!;
  const group = groups.get(groupKey(s));
  const pending = () => s.invitees.filter((p) => !answers[p]);
  let answers = s.answers;

  if (msg.type === "timeout") {
    if (s.nudges >= 1) return new Command({ goto: "finalize" });
    for (const p of pending()) await sendTo(p, `Still need your RSVP: ${s.step.description}. YES or NO?`, s.request.id);
    ev(s, "reminder_sent", { to: pending() });
    return new Command({ update: { nudges: s.nudges + 1 }, goto: "await_rsvps" });
  }
  if (msg.type !== "reply") return new Command({ goto: "await_rsvps" });

  const answer = await readAnswer(msg.text);
  answers = { ...s.answers, [msg.from]: answer };
  const yes = Object.values(answers).filter((a) => a === "yes").length;
  ev(s, "rsvp_received", { from: msg.from, answer, yes });
  await group?.send(`${firstName(msg.from)}: ${answer === "yes" ? "✅" : answer === "no" ? "❌" : "🤔"} · ${yes} going so far`);

  return new Command({ update: { answers }, goto: pending().length ? "await_rsvps" : "finalize" });
}

async function finalize(s: S) {
  const yes = Object.entries(s.answers).filter(([, a]) => a === "yes").map(([p]) => p);
  const silent = s.invitees.filter((p) => !s.answers[p]);
  await tell(s, `Headcount: ${yes.length} (${yes.map(firstName).join(", ")})${silent.length ? `. No reply from ${silent.map(firstName).join(", ")}` : ""}.`);
  await groups.get(groupKey(s))?.send(`Final headcount: ${yes.length}. Thanks all!`);
  groups.delete(groupKey(s));
  ev(s, "rsvp_closed", { headcount: yes.length, yes, no_reply: silent });
  return {
    result: {
      status: "done" as const,
      summary: `${yes.length} confirmed: ${yes.map(firstName).join(", ")}`,
      data: { headcount: yes.length, attendees: yes },
    },
  };
}

export const buildRsvpAgent = () =>
  new StateGraph(RsvpState)
    .addNode("resolve_invitees", resolveInvitees, { ends: ["invite", END] })
    .addNode("invite", invite)
    .addNode("await_rsvps", awaitRsvps)
    .addNode("on_rsvp", onRsvp, { ends: ["await_rsvps", "finalize"] })
    .addNode("finalize", finalize)
    .addEdge(START, "resolve_invitees")
    .addEdge("invite", "await_rsvps")
    .addEdge("await_rsvps", "on_rsvp")
    .addEdge("finalize", END);
