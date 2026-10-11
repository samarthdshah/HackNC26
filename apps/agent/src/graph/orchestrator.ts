// The orchestrator: one thread per request. It plans with two agents, then runs
// the plan as a dependency graph, handing each step to a specialist agent that
// runs as its own thread (see agents/ and runner.ts). Independent steps run in
// parallel; results flow downstream as briefings.
//
//   understand ─┬─▶ planner ⇄ critic ─▶ announce ─▶ schedule ─┬─▶ await_agents ─▶ on_result ─┬─▶ schedule
//               │   (≤2 revisions)                            │                              └─▶ recover ─▶ schedule
//               └─▶ clarify ─▶ await_requester ─▶ after_clarify                              │
//                                                             └─▶ wrap_up ◀──────────────────┘ (abort)
//
// await_* nodes only pause; every other node may send messages. LangGraph re-runs
// a paused node from the top on resume, so this split keeps sends exactly-once.

import { Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { StepResult } from "@wayfinder/shared";
import { z } from "zod";
import { ask, askJson } from "../brain/gemini.ts";
import { getPerson, typical } from "../data/fixtures.ts";
import { emit } from "../events.ts";
import { postWarRoom, sendTo } from "../messenger.ts";
import { firstName, isSensitive, nameOf } from "../org/entities.ts";
import { taskTypes } from "../org/map.ts";
import { critiquePlan, proposePlan } from "../tools/plan.ts";
import { OrchestratorState, type Launch, type OState, type OUpdate, type Resume, type Step, type Waiting } from "./state.ts";

const MAX_PLAN_REVISIONS = 2;
const AGENT_LABEL: Record<Step["kind"], string> = {
  action: "👤",
  approval: "✍️",
  payment: "💸",
  call: "📞",
  rsvp: "🙋",
  room: "🏢",
};

const formatHours = (h: number) => (h < 1.5 ? `${Math.round(h * 60)} min` : h < 36 ? `~${Math.round(h)} h` : `~${Math.round(h / 24)} days`);
const tell = (s: OState, text: string) => sendTo(s.request.requester, text, s.request.id);
const ev = (s: OState, type: string, payload: Record<string, unknown> = {}) =>
  emit(type, "agent", { title: s.request.title, ...payload }, { request_id: s.request.id });
const terminal = (st: Step) => ["done", "denied", "failed", "skipped"].includes(st.status);

// ── understand / clarify ────────────────────────────────────────────────────

const Understanding = z.object({
  title: z.string().describe("3-7 word title"),
  task_type: z.string().describe("Closest allowed task type, or 'other'"),
  amount_usd: z.number().optional().describe("Money involved, if stated or implied by quantity and price"),
  severity: z
    .enum(["sev1", "sev2"])
    .optional()
    .describe("Incidents only (POL-INC-1): sev1 = customers cannot pay, sev2 = checkout degraded"),
  question: z
    .string()
    .optional()
    .describe(
      "Only if you cannot tell what kind of task this is or who it is for: the single question to ask. " +
        "Never ask about details an owner can sort out (times, sizes, menus, locations).",
    ),
});

async function understand(s: OState): Promise<Command> {
  const requester = getPerson(s.request.requester);
  const u = await askJson(
    `Request from ${requester?.name} (${requester?.role}):\n"${s.request.goal}"\n\nAllowed task types: ${taskTypes().join(", ")}`,
    Understanding,
    "You triage workplace requests. Act first: owners can ask follow-ups themselves. Leave question empty unless truly blocked.",
  );
  const request = { ...s.request, title: u.title, task_type: u.task_type, amount_usd: u.amount_usd, severity: u.severity };
  if (u.question) return new Command({ update: { request, log: [`asked: ${u.question}`] }, goto: "clarify" });
  emit("request_created", s.request.requester, { goal: s.request.goal, title: u.title, task_type: u.task_type, amount_usd: u.amount_usd, ...(u.severity && { severity: u.severity }) }, { request_id: s.request.id });
  return new Command({ update: { request }, goto: "planner" });
}

async function clarify(s: OState): Promise<OUpdate> {
  await tell(s, s.log.at(-1)?.replace(/^asked: /, "") ?? "Can you tell me a bit more?");
  return {};
}

function awaitRequester(s: OState): OUpdate {
  const incoming = interrupt<Waiting, Resume>({
    kind: "clarify",
    waitingOn: [s.request.requester],
    summary: `More detail for "${s.request.goal}"`,
  });
  return { incoming };
}

function afterClarify(s: OState): Command {
  if (s.incoming?.type !== "reply") {
    return new Command({ update: { outcome: "stuck", log: ["no answer to clarifying question"] }, goto: "wrap_up" });
  }
  return new Command({ update: { request: { ...s.request, goal: `${s.request.goal}\n(${s.incoming.text})` } }, goto: "understand" });
}

// ── planning: planner ⇄ critic ──────────────────────────────────────────────

const planInput = (s: OState) => ({
  goal: s.request.goal,
  requester: s.request.requester,
  task_type: s.request.task_type,
  amount_usd: s.request.amount_usd,
});

async function planner(s: OState): Promise<OUpdate> {
  const steps = await proposePlan(planInput(s), s.critique, s.steps.length ? s.steps : undefined);
  ev(s, "plan_proposed", { round: s.planRounds, steps });
  return { steps: steps.map((x) => ({ ...x, status: "pending" as const })), planRounds: s.planRounds + 1 };
}

async function critic(s: OState): Promise<Command> {
  const verdict = await critiquePlan(planInput(s), s.steps);
  ev(s, "plan_reviewed", { round: s.planRounds, ...verdict });
  if (!verdict.approved && s.planRounds <= MAX_PLAN_REVISIONS) {
    return new Command({ update: { critique: verdict.issues }, goto: "planner" });
  }
  return new Command({ update: { critique: verdict.issues }, goto: "announce" });
}

async function announce(s: OState): Promise<OUpdate> {
  ev(s, "plan_created", { steps: s.steps, revisions: s.planRounds - 1 });
  const lines = s.steps.map((x) => `${AGENT_LABEL[x.kind]} ${x.description}${x.depends_on.length ? ` (after ${x.depends_on.join(", ")})` : ""}`);
  const t = typical[s.request.task_type ?? ""];
  const usually = t && t.requests >= 2 ? ` (these usually take ${formatHours(t.median_hours)} and ${Math.round(t.avg_hops)} handoffs; I'll keep it moving)` : "";
  await tell(
    s,
    s.steps.length === 1
      ? `On it: ${s.steps[0].description}${usually}`
      : `On it. Plan:\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}${usually ? `\n${usually.trim().slice(1, -1)}` : ""}`,
  );
  await postWarRoom(`📋 ${s.request.title} (${nameOf(s.request.requester)}): ${s.steps.length} steps`, s.request.id, isSensitive(s.request.task_type));
  return {};
}

// ── scheduling ─────────────────────────────────────────────────────────────

/** Results of every step upstream of `st` (not just direct dependencies), oldest first. */
function briefingFor(s: OState, st: Step): string {
  const upstream = new Set<string>();
  const visit = (id: string) => {
    if (upstream.has(id)) return;
    upstream.add(id);
    s.steps.find((x) => x.id === id)?.depends_on.forEach(visit);
  };
  st.depends_on.forEach(visit);
  return s.steps
    .filter((d) => upstream.has(d.id) && d.result)
    .map((d) => `${d.id} (${d.kind}): ${d.result!.summary}${d.result!.data ? ` ${JSON.stringify(d.result!.data)}` : ""}`)
    .join("\n");
}

function schedule(s: OState): Command {
  const byId = new Map(s.steps.map((x) => [x.id, x]));
  // Anything downstream of a failure or denial can't run.
  let steps = s.steps;
  let changed = true;
  while (changed) {
    changed = false;
    steps = steps.map((x) => {
      if (x.status !== "pending") return x;
      const blocked = x.depends_on.some((d) => ["denied", "failed", "skipped"].includes(byId.get(d)?.status ?? ""));
      if (!blocked) return x;
      changed = true;
      const skipped = { ...x, status: "skipped" as const };
      byId.set(x.id, skipped);
      return skipped;
    });
  }

  const ready = steps.filter((x) => x.status === "pending" && x.depends_on.every((d) => byId.get(d)?.status === "done"));
  const launch: Launch[] = ready.map((x) => ({
    request: s.request,
    step: { ...x, status: "running" },
    briefing: briefingFor({ ...s, steps }, x),
  }));
  steps = steps.map((x) => (ready.includes(x) ? { ...x, status: "running" as const } : x));

  if (launch.length === 0 && !steps.some((x) => x.status === "running")) {
    const ok = steps.every((x) => x.status === "done");
    const outcome = ok ? "done" : steps.some((x) => x.status === "denied") ? "denied" : "stuck";
    return new Command({ update: { steps, outcome }, goto: "wrap_up" });
  }
  for (const l of launch) ev(s, "agent_launched", { step: l.step.id, agent: l.step.kind, parallel: launch.length > 1 });
  return new Command({ update: { steps, launch }, goto: "await_agents" });
}

function awaitAgents(s: OState): OUpdate {
  const running = s.steps.filter((x) => x.status === "running");
  const incoming = interrupt<Waiting, Resume>({
    kind: "agents",
    waitingOn: [],
    summary: `${s.request.title}: ${running.map((x) => `${x.id}/${x.kind}`).join(", ")} running`,
    spawn: s.launch,
  });
  return { incoming, launch: [] };
}

async function onResult(s: OState): Promise<Command> {
  const msg = s.incoming;
  if (msg?.type !== "agent_result") return new Command({ goto: "schedule" });
  const result: StepResult = msg.result;
  const steps = s.steps.map((x) =>
    x.id === msg.step_id ? { ...x, status: result.status, owner: result.owner ?? x.owner, result } : x,
  );
  const st = steps.find((x) => x.id === msg.step_id)!;
  ev(s, "step_finished", { step: st.id, agent: st.kind, status: result.status, summary: result.summary });

  if (result.status === "done") {
    const signedOff = st.kind === "approval" && (result.data?.approved_by as string[] | undefined)?.length;
    if (st.kind === "action" || signedOff) await tell(s, `✅ ${result.summary}`);
    return new Command({ update: { steps }, goto: "schedule" });
  }
  return new Command({ update: { steps }, goto: "recover" });
}

// ── recovery agent ─────────────────────────────────────────────────────────

const Recovery = z.object({
  decision: z
    .enum(["retry", "continue", "abort"])
    .describe("retry: run the failed step once more. continue: drop it and whatever depends on it, finish the rest. abort: stop the request."),
  message: z.string().describe("One or two sentences to the requester explaining what happened and what happens next"),
});

async function recover(s: OState): Promise<Command> {
  const failed = s.steps.filter((x) => (x.status === "failed" || x.status === "denied") && !s.log.includes(`recovered:${x.id}`));
  const st = failed.at(-1);
  if (!st) return new Command({ goto: "schedule" });

  const dependents = s.steps.filter((x) => x.depends_on.includes(st.id)).map((x) => x.description);
  const r = await askJson(
    `Request: ${s.request.goal}\nStep ${st.id} (${st.kind}) ${st.status}: ${st.result?.summary}\n` +
      `Attempts so far: ${(st.attempts ?? 0) + 1}\nSteps that depend on it: ${dependents.join("; ") || "none"}\n` +
      `Other steps: ${s.steps.filter((x) => x.id !== st.id).map((x) => `${x.id} ${x.status}`).join(", ")}`,
    Recovery,
    `You are the recovery agent. A denial is a human decision: never retry it; abort if the denial kills the point of the
request, otherwise continue. Retry a failure at most once, and only if it looks transient.`,
  );
  // Humans' denials are final and failures get one retry, whatever the model says.
  let decision = r.decision;
  if (decision === "retry" && (st.status === "denied" || (st.attempts ?? 0) >= 1)) decision = "continue";
  ev(s, "recovery_decision", { step: st.id, decision, message: r.message });
  await tell(s, `${st.status === "denied" ? "⛔" : "⚠️"} ${r.message}`);

  if (decision === "retry") {
    const steps = s.steps.map((x) => (x.id === st.id ? { ...x, status: "pending" as const, attempts: (x.attempts ?? 0) + 1, result: undefined } : x));
    return new Command({ update: { steps, log: [`recovered:${st.id}`] }, goto: "schedule" });
  }
  if (decision === "abort") {
    const steps = s.steps.map((x) => (terminal(x) ? x : { ...x, status: "skipped" as const }));
    return new Command({ update: { steps, outcome: st.status === "denied" ? "denied" : "stuck", log: [`recovered:${st.id}`] }, goto: "wrap_up" });
  }
  return new Command({ update: { log: [`recovered:${st.id}`] }, goto: "schedule" });
}

// ── wrap up: summary agent ─────────────────────────────────────────────────

async function wrapUp(s: OState): Promise<OUpdate> {
  const title = s.request.title ?? s.request.goal;
  const icon = { done: "✅", denied: "⛔", stuck: "⚠️", open: "•" }[s.outcome];
  const record = s.steps.map((x) => `${x.id} ${x.kind} [${x.status}] ${x.description} → ${x.result?.summary ?? "-"} ${x.result?.data ? JSON.stringify(x.result.data) : ""}`);
  if (s.outcome === "done" && s.steps.length > 1) {
    const recap = await ask(
      `Write a 2-3 sentence wrap-up text to ${firstName(s.request.requester)} for "${title}". Include amounts, who did what, and any receipt link verbatim.\n${record.join("\n")}`,
      "Plain text, upbeat, concise, no markdown.",
    );
    await tell(s, `${icon} ${recap}`);
  } else if (s.outcome === "done") {
    await tell(s, `${icon} All set: ${title}.`);
  }
  await postWarRoom(`${icon} ${title}: ${s.outcome}`, s.request.id, isSensitive(s.request.task_type));
  ev(s, `request_${s.outcome === "done" ? "resolved" : s.outcome}`, { steps: s.steps });
  return {};
}

// ── wiring ─────────────────────────────────────────────────────────────────

export function buildOrchestrator() {
  return new StateGraph(OrchestratorState)
    .addNode("understand", understand, { ends: ["planner", "clarify"] })
    .addNode("clarify", clarify)
    .addNode("await_requester", awaitRequester)
    .addNode("after_clarify", afterClarify, { ends: ["understand", "wrap_up"] })
    .addNode("planner", planner)
    .addNode("critic", critic, { ends: ["planner", "announce"] })
    .addNode("announce", announce)
    .addNode("schedule", schedule, { ends: ["await_agents", "wrap_up"] })
    .addNode("await_agents", awaitAgents)
    .addNode("on_result", onResult, { ends: ["schedule", "recover"] })
    .addNode("recover", recover, { ends: ["schedule", "wrap_up"] })
    .addNode("wrap_up", wrapUp)
    .addEdge(START, "understand")
    .addEdge("clarify", "await_requester")
    .addEdge("await_requester", "after_clarify")
    .addEdge("planner", "critic")
    .addEdge("announce", "schedule")
    .addEdge("await_agents", "on_result")
    .addEdge("wrap_up", END);
}
