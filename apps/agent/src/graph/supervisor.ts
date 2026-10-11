// The supervisor: every inbound text goes through this graph once.
//
//   identify ─┬─▶ command ──────────────────────────────▶ END
//             ├─▶ unknown_sender ───────────────────────▶ END
//             └─▶ triage ─┬─▶ resume_request (hand off: resume a coordinator thread)
//                         ├─▶ new_request    (hand off: start a coordinator thread)
//                         ├─▶ answer         (Q&A tool-loop agent)
//                         └─▶ chat
//
// It is stateless per message. It only *decides* on coordinator hand-offs;
// handleInbound runs them after the graph returns. Invoking the coordinator
// inside a node would make it a subgraph, and its interrupts would bubble up
// into this checkpoint-less graph.

import { Annotation, Command, END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { voice, type Space } from "spectrum-ts";
import { z } from "zod";
import { answer } from "../brain/answer.ts";
import { sendBriefing } from "../brain/briefing.ts";
import { ask, askJson } from "../brain/gemini.ts";
import { company, getPerson } from "../data/fixtures.ts";
import { emit } from "../events.ts";
import { sendTo, setWarRoom } from "../messenger.ts";
import { bind, personFor, type Handle } from "../org/directory.ts";
import { describePerson, nameOf, resolveEntity } from "../org/entities.ts";
import { allEdges, resetMap } from "../org/map.ts";
import { tts } from "../voice/elevenlabs.ts";
import { resetHops } from "./hops.ts";
import { requestOf, retryFailed } from "./runner.ts";
import { allPaused, listRequests, resetRunner, resume, settle, snapshot, startRequest, waitingOn } from "./runner.ts";

const last = <T>(fallback: T) => Annotation<T>({ reducer: (_, next) => next, default: () => fallback });

const SupervisorState = Annotation.Root({
  handle: Annotation<Handle>,
  text: Annotation<string>,
  person: last<string | undefined>(undefined),
  reply: last<string | undefined>(undefined),
  handoff: last<Handoff | undefined>(undefined),
});

type Handoff = { type: "start"; goal: string } | { type: "resume"; threadId: string; text: string };

type S = typeof SupervisorState.State;
type Ctx = LangGraphRunnableConfig<{ space?: Space }>;

const HELP = `Commands: /iam <name> · /as <name> (terminal) · /status · /briefing · /retry · /map <task_type> · /warroom · /voice <text> · /who <name> · /whoami · /reset`;

// ── identify ───────────────────────────────────────────────────────────────

function identify(s: S): Command {
  // The website passes the person it speaks as; it never binds a handle (that would steal a phone's persona).
  const person = s.person ?? personFor(s.handle);
  if (s.text.startsWith("/")) return new Command({ update: { person }, goto: "command" });
  if (!person) return new Command({ goto: "unknown_sender" });
  emit("message_in", person, { text: s.text, platform: s.handle.platform });
  return new Command({ update: { person }, goto: "triage" });
}

function unknownSender(): Partial<S> {
  return { reply: `Hi! I'm Wayfinder for ${company.name}. Who are you? Text /iam <your name>, e.g. /iam Leo` };
}

// ── commands ───────────────────────────────────────────────────────────────

async function command(s: S, config: Ctx): Promise<Partial<S>> {
  const [cmd, ...rest] = s.text.trim().split(/\s+/);
  const arg = rest.join(" ");
  const space = config.configurable?.space;

  switch (cmd.toLowerCase()) {
    case "/ping":
      return { reply: "pong" };
    case "/help":
      return { reply: HELP };
    case "/whoami":
      return { reply: `${s.handle.platform}:${s.handle.id}${s.person ? ` · playing ${nameOf(s.person)}` : " · not bound (/iam <name>)"}` };
    case "/iam":
    case "/as": {
      const id = resolveEntity(arg);
      const p = id && getPerson(id);
      if (!p) return { reply: `Couldn't find "${arg}". Try a first name like /iam leo` };
      bind(p.id, s.handle);
      emit("identity_bound", p.id, { handle: s.handle });
      const waiting = waitingOn(p.id).length;
      return { reply: `You're ${describePerson(p)}.${waiting ? ` ${waiting} thing(s) waiting on you, /status to see.` : ""}` };
    }
    case "/who": {
      const id = resolveEntity(arg);
      const p = id && getPerson(id);
      return { reply: p ? describePerson(p) : id ? nameOf(id) : `No one matches "${arg}"` };
    }
    case "/status":
      return { reply: await statusText(s.person) };
    case "/briefing":
      if (!s.person) return { reply: "Tell me who you are first: /iam <name>" };
      await sendBriefing(s.person);
      return {};
    case "/map": {
      const rows = allEdges().filter((e) => !arg || e.task_type === arg);
      return {
        reply: rows.length
          ? rows.map((e) => `${nameOf(e.from)} → ${nameOf(e.to)} [${e.task_type}] ${e.confidence}${e.source === "learned" ? " 🧠" : ""}`).join("\n")
          : `No edges for ${arg}`,
      };
    }
    case "/warroom":
      if (!space) return { reply: "Run /warroom inside the group chat you want status posts in." };
      setWarRoom(space);
      return { reply: "📡 This chat is now the war room. Status updates on every request will land here." };
    case "/voice": {
      if (!space) return { reply: "No chat to send a voice note to." };
      const audio = await tts(arg || `Hi, this is Wayfinder for ${company.name}. Voice is working.`);
      await space.send(voice(audio, { mimeType: "audio/mpeg", name: "wayfinder.mp3" }));
      return {};
    }
    case "/retry": {
      const n = retryFailed();
      return { reply: n ? `Retrying ${n} paused step(s)…` : "Nothing is paused." };
    }
    case "/reset":
      resetRunner();
      resetMap();
      resetHops();
      return { reply: "Reset: requests cleared, org map back to the chart. Identities kept." };
    default:
      return { reply: HELP };
  }
}

async function statusText(person?: string): Promise<string> {
  const lines: string[] = [];
  const mine = person ? waitingOn(person) : allPaused();
  mine.forEach((p, i) => lines.push(`${i + 1}. waiting on ${p.waitingOn.map(nameOf).join("/")}: ${p.summary}`));
  for (const r of listRequests()) {
    const snap = await snapshot(r.id);
    if (!snap) continue;
    lines.push(`• ${r.id} ${snap.request.title ?? r.goal} (${nameOf(r.requester)}) → ${snap.outcome}`);
  }
  return lines.length ? lines.join("\n") : "Nothing in flight.";
}

// ── triage ─────────────────────────────────────────────────────────────────

const Triage = z.object({
  intent: z.enum(["pending_reply", "new_request", "question", "chat"]),
  pending_number: z.number().optional().describe("Which numbered pending item the message answers"),
});

async function triage(s: S): Promise<Command> {
  const person = s.person!;
  // A thread may be mid-run and about to ask this person something; let it pause first.
  if (waitingOn(person).length === 0) await settle(6000);
  const pending = waitingOn(person);
  const text = s.text.trim();

  // One thing waiting and a one-word answer: no need to ask the model.
  if (pending.length === 1 && /^(yes|no|y|n|yep|nope|approve[d]?|deny|denied|done)\b[.!]?$/i.test(text)) {
    return new Command({ update: { handoff: { type: "resume", threadId: pending[0].threadId, text } }, goto: "resume_request" });
  }

  // "APPROVE 2" / "done 1" pick a numbered item explicitly.
  const numbered = text.match(/^(\w+)\s+(\d+)$/);
  if (numbered && pending[Number(numbered[2]) - 1]) {
    return new Command({
      update: { handoff: { type: "resume", threadId: pending[Number(numbered[2]) - 1].threadId, text: numbered[1] } },
      goto: "resume_request",
    });
  }

  const list = pending.map((p, i) => `${i + 1}. [${p.kind}] ${p.summary}${p.ask ? ` (we asked: "${p.ask}")` : ""}`).join("\n");
  const t = await askJson(
    `Message from ${nameOf(person)}: "${text}"\n\nItems currently waiting on them:\n${list || "(none)"}`,
    Triage,
    `Route an inbound message for a workplace coordinator.
pending_reply: it answers, approves, denies, redirects or comments on a waiting item.
new_request: they want something done (access, booking, ordering, help from another team).
question: they want information (who handles X, policy, status of their requests).
chat: greetings or small talk.`,
  );

  if (t.intent === "pending_reply" && pending.length) {
    const item = pending[(t.pending_number ?? 1) - 1] ?? pending[0];
    if (pending.length > 1 && !t.pending_number) {
      return new Command({
        update: { reply: `Which one?\n${pending.map((p, i) => `${i + 1}. ${p.summary}`).join("\n")}\nReply e.g. "DONE 1".` },
        goto: END,
      });
    }
    return new Command({ update: { handoff: { type: "resume", threadId: item.threadId, text } }, goto: "resume_request" });
  }
  if (t.intent === "new_request") {
    return new Command({ update: { handoff: { type: "start", goal: text } }, goto: "new_request" });
  }
  return new Command({ goto: t.intent === "question" ? "answer" : "chat" });
}

function resumeRequest(s: S): Partial<S> {
  const h = s.handoff as Extract<Handoff, { type: "resume" }>;
  emit("handoff", "agent", { to: "coordinator", thread: h.threadId, from: s.person });
  return {};
}

function newRequest(s: S): Partial<S> {
  emit("handoff", "agent", { to: "coordinator", thread: "new", from: s.person });
  return {};
}

async function answerNode(s: S): Promise<Partial<S>> {
  return { reply: await answer(s.person!, s.text) };
}

async function chat(s: S): Promise<Partial<S>> {
  const reply = await ask(
    s.text,
    `You are Wayfinder, ${company.name}'s coordinator in iMessage, talking to ${nameOf(s.person!)}. One short friendly sentence. Mention you can get things done for them (access, rooms, catering, approvals).`,
  );
  return { reply };
}

export const supervisor = new StateGraph(SupervisorState)
  .addNode("identify", identify, { ends: ["command", "unknown_sender", "triage"] })
  .addNode("command", command)
  .addNode("unknown_sender", unknownSender)
  .addNode("triage", triage, { ends: ["resume_request", "new_request", "answer", "chat", END] })
  .addNode("resume_request", resumeRequest)
  .addNode("new_request", newRequest)
  .addNode("answer", answerNode)
  .addNode("chat", chat)
  .addEdge(START, "identify")
  .addEdge("command", END)
  .addEdge("unknown_sender", END)
  .addEdge("resume_request", END)
  .addEdge("new_request", END)
  .addEdge("answer", END)
  .addEdge("chat", END)
  .compile({ name: "supervisor" });

/** Run a coordinator hand-off the supervisor decided on. */
async function dispatch(person: string, h: Handoff | undefined, platform: string): Promise<void> {
  // The coordinator texts the requester itself, so hand-offs need no direct reply.
  if (h?.type === "start") await startRequest(person, h.goal);
  if (h?.type === "resume") {
    // message_in has no request; this ties the reply to the request it answers (Currents shows it).
    emit("reply_in", person, { text: h.text, platform }, { request_id: requestOf(h.threadId) });
    await resume(h.threadId, { type: "reply", from: person, text: h.text });
  }
}

/** Handle one inbound text; returns the direct reply to send back, if any. */
export async function handleInbound(handle: Handle, text: string, space?: Space): Promise<string | undefined> {
  const out = await supervisor.invoke({ handle, text }, { configurable: { space } });
  await dispatch(out.person!, out.handoff, handle.platform);
  return out.reply;
}

/**
 * The website speaking as a person (POST /say), as if they had texted. With a request id,
 * a reply this person owes that request resumes it directly. Hand-offs run in the background:
 * the browser sees them as live events. Returns as soon as the route is decided.
 */
export async function handleAs(
  person: string,
  text: string,
  opts: { requestId?: string; mirror?: boolean } = {},
): Promise<{ route: "resume" | "start" | "reply" | "none"; request_id?: string; reply?: string }> {
  const handle: Handle = { platform: "web", id: person };
  const background = (h: Handoff) => void dispatch(person, h, "web").catch((err) => console.error(`[web] ${err}`));

  const owedNow = () => (opts.requestId ? waitingOn(person).find((p) => requestOf(p.threadId) === opts.requestId) : undefined);
  // The request may still be mid-run, about to ask this person; let it pause first so an early
  // reply isn't mistaken for small talk.
  let owed = owedNow();
  if (opts.requestId && !owed) {
    await settle(10_000);
    owed = owedNow();
  }
  if (owed) {
    emit("message_in", person, { text, platform: "web" }, { request_id: opts.requestId });
    background({ type: "resume", threadId: owed.threadId, text });
    return { route: "resume", request_id: opts.requestId };
  }

  const out = await supervisor.invoke({ handle, text, person });
  const h = out.handoff;
  if (h) {
    background(h);
    return h.type === "resume" ? { route: "resume", request_id: requestOf(h.threadId) } : { route: "start" };
  }
  if (!out.reply) return { route: "none" };
  emit("message_out", "agent", { to: person, text: out.reply, platform: "web" }, { request_id: opts.requestId });
  if (opts.mirror) await sendTo(person, out.reply, opts.requestId);
  return { route: "reply", reply: out.reply, request_id: opts.requestId };
}

