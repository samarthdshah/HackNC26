// Human-task agent: gets one action step done by the right person.
//
//   route ─▶ draft_ask ─▶ dispatch ─▶ await_owner ─▶ on_reply ─┬─▶ route        (redirect / delegate / escalate)
//                                                              ├─▶ await_owner  (ack / question / nudge)
//                                                              └─▶ END          (done / denied / stuck)

import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { classifyReply } from "../../brain/classify.ts";
import { getPerson } from "../../data/fixtures.ts";
import { env } from "../../env.ts";
import { postWarRoom, sendTo } from "../../messenger.ts";
import { firstName, isSensitive, isTeam, nameOf, resolveEntity } from "../../org/entities.ts";
import { learnDelegate, learnRedirect, reinforce } from "../../org/map.ts";
import { draft } from "../../tools/draft.ts";
import { route } from "../../tools/route.ts";
import { agentBase, last, type Assignment, type Resume, type Waiting } from "../state.ts";
import { ev, tell } from "./common.ts";

const MAX_HOPS = 4;

const HumanState = Annotation.Root({
  ...agentBase,
  assignment: last<Assignment | null>(null),
  exclude: last<string[]>([]),
  prefer: last<string | undefined>(undefined),
  hops: last<number>(0),
  bounces: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});
type S = typeof HumanState.State;

async function routeNode(s: S): Promise<Command> {
  const st = s.step;
  if (s.hops >= MAX_HOPS) {
    return new Command({
      update: { result: { status: "failed", summary: `Bounced ${s.hops} times without finding an owner` } },
      goto: END,
    });
  }
  const r = route({ task_type: st.task_type, requester: s.request.requester, exclude: s.exclude, prefer: s.prefer });
  if (!r.owner) {
    return new Command({ update: { result: { status: "failed", summary: `No owner found for ${st.task_type}` } }, goto: END });
  }
  ev(s, "routed", { task_type: st.task_type, owner: r.owner, chain: r.chain, confidence: r.confidence, source: r.source });
  return new Command({ update: { assignment: { ...r, owner: r.owner, reminders: 0 }, hops: s.hops + 1 }, goto: "draft_ask" });
}

async function draftAsk(s: S) {
  const a = s.assignment!;
  const covering = a.delegated_from
    ? `They are covering for ${nameOf(a.delegated_from)}, who is out until ${getPerson(a.delegated_from)?.out_until?.slice(0, 10)}. Mention that.`
    : "";
  const { text } = await draft({
    to: a.owner,
    intent: `Ask them to do this for ${nameOf(s.request.requester)}. Tell them to reply DONE when it's handled, or say who owns it if it isn't theirs.`,
    context: [
      `Request: ${s.request.goal}`,
      `Step: ${s.step.description}`,
      covering,
      s.briefing && `Already done:\n${s.briefing}`,
      s.bounces.length && `Earlier: ${s.bounces.join("; ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
  return { assignment: { ...a, ask: text } };
}

async function dispatch(s: S) {
  const a = s.assignment!;
  await sendTo(a.owner, a.ask!, s.request.id);
  const via = a.chain.length > 1 && isTeam(a.chain[0]) ? ` (${nameOf(a.chain[0])})` : "";
  const cover = a.delegated_from ? `, covering for ${firstName(a.delegated_from)}` : "";
  await tell(s, `Sent "${s.step.description}" to ${nameOf(a.owner)}${via}${cover}.`);
  await postWarRoom(`🔵 ${s.request.title}: ${s.step.id} with ${nameOf(a.owner)}${via}`, s.request.id, isSensitive(s.request.task_type));
  return {};
}

function awaitOwner(s: S) {
  const incoming = interrupt<Waiting, Resume>({
    kind: "owner",
    waitingOn: [s.assignment!.owner, s.request.requester],
    summary: `${s.request.title}: ${s.step.description}`,
    ask: s.assignment!.ask,
  });
  return { incoming };
}

async function onReply(s: S): Promise<Command> {
  const a = s.assignment!;
  const st = s.step;
  const msg = s.incoming!;

  if (msg.type === "timeout") {
    if (a.reminders >= env.maxReminders) {
      const boss = getPerson(a.owner)?.manager_id;
      ev(s, "escalated", { from: a.owner, to: boss });
      await tell(s, `${firstName(a.owner)} hasn't replied. Escalating${boss ? ` to ${nameOf(boss)}` : ""}.`);
      return new Command({ update: { prefer: boss, exclude: [...s.exclude, a.owner] }, goto: "route" });
    }
    await sendTo(a.owner, `Quick nudge: ${st.description}. Reply DONE when it's handled.`, s.request.id);
    ev(s, "reminder_sent", { to: a.owner });
    return new Command({ update: { assignment: { ...a, reminders: a.reminders + 1 } }, goto: "await_owner" });
  }
  if (msg.type !== "reply") return new Command({ goto: "await_owner" });

  if (msg.from === s.request.requester && msg.from !== a.owner) {
    await sendTo(a.owner, `${firstName(msg.from)} adds: ${msg.text}`, s.request.id);
    return new Command({ goto: "await_owner" });
  }

  const verdict = await classifyReply(msg.text, a.ask ?? "", false);
  const by = msg.from;
  const entry = a.entry ?? a.owner;

  switch (verdict.kind) {
    case "done":
      reinforce(a.chain, st.task_type);
      ev(s, "step_done", { by, chain: a.chain });
      if (a.delegated_from) {
        await sendTo(a.delegated_from, `FYI: ${firstName(by)} handled "${st.description}" while you're out.`, s.request.id);
      }
      return new Command({
        update: { verdict, result: { status: "done", owner: by, summary: `${firstName(by)}: ${msg.text}` } },
        goto: END,
      });

    case "accept":
      await tell(s, `${firstName(by)} is on it.`);
      return new Command({ update: { verdict }, goto: "await_owner" });

    case "redirect":
    case "delegate": {
      const target = resolveEntity(verdict.target);
      if (!target) {
        await sendTo(by, "Got it. Who should I send it to instead?", s.request.id);
        return new Command({ update: { verdict }, goto: "await_owner" });
      }
      if (verdict.kind === "delegate" && !isTeam(target)) {
        learnDelegate(a.owner, target, st.task_type, verdict.until, s.request.id);
        ev(s, "delegated", { from: a.owner, to: target, task_type: st.task_type, until: verdict.until });
        await tell(s, `${firstName(a.owner)} handed it to ${nameOf(target)}.`);
      } else {
        const { demoted, learned } = learnRedirect("agent", entry, target, st.task_type, s.request.id);
        ev(s, "redirected", { from: entry, to: target, by, task_type: st.task_type, demoted, learned });
        await tell(s, `${firstName(by)} says it's not ${nameOf(entry)}, it's ${nameOf(target)}. Rerouting, and I'll remember that.`);
        await postWarRoom(`🧠 Learned: ${st.task_type} → ${nameOf(target)} (not ${nameOf(entry)})`, s.request.id, isSensitive(st.task_type));
      }
      return new Command({
        update: {
          verdict,
          prefer: target,
          exclude: [...s.exclude, entry],
          bounces: [`${nameOf(entry)} said "${msg.text}"`],
        },
        goto: "route",
      });
    }

    case "deny":
      ev(s, "denied", { by, note: verdict.note });
      return new Command({
        update: { verdict, result: { status: "denied", owner: by, summary: `${firstName(by)} declined: ${msg.text}` } },
        goto: END,
      });

    case "question":
      await tell(s, `${firstName(by)} asks: ${verdict.note ?? msg.text}`);
      return new Command({ update: { verdict }, goto: "await_owner" });

    default:
      await sendTo(by, "Thanks! Reply DONE once it's handled, or tell me who owns it if it's not you.", s.request.id);
      return new Command({ update: { verdict }, goto: "await_owner" });
  }
}

export const buildHumanAgent = () =>
  new StateGraph(HumanState)
    .addNode("route", routeNode, { ends: ["draft_ask", END] })
    .addNode("draft_ask", draftAsk)
    .addNode("dispatch", dispatch)
    .addNode("await_owner", awaitOwner)
    .addNode("on_reply", onReply, { ends: ["route", "await_owner", END] })
    .addEdge(START, "route")
    .addEdge("draft_ask", "dispatch")
    .addEdge("dispatch", "await_owner")
    .addEdge("await_owner", "on_reply");
