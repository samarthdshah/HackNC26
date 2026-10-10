// Runs every graph thread: one orchestrator thread per request, one specialist
// agent thread per step. Agents are spawned here, outside any graph run, from
// the orchestrator's interrupt payload (spawning inside a node would turn the
// agent into a subgraph and its interrupts would bubble into the orchestrator).
// When an agent finishes, its result resumes the orchestrator.
//
// Also tracks which people each paused thread waits on, so inbound texts find
// their thread, and arms reminder timers.

import { Command, INTERRUPT, MemorySaver, isInterrupted } from "@langchain/langgraph";
import type { StepResult } from "@wayfinder/shared";
import { env } from "../env.ts";
import { emit } from "../events.ts";
import { buildApprovalAgent } from "./agents/approval.ts";
import { buildHumanAgent } from "./agents/human.ts";
import { buildRsvpAgent } from "./agents/rsvp.ts";
import { buildTreasuryAgent } from "./agents/treasury.ts";
import { buildVoiceAgent } from "./agents/voice.ts";
import { buildOrchestrator } from "./orchestrator.ts";
import type { Launch, OState, Request, Resume, Step, Waiting } from "./state.ts";

type GraphName = "orchestrator" | Step["kind"];

function compileAll(checkpointer: MemorySaver) {
  const opts = { checkpointer };
  return {
    orchestrator: buildOrchestrator().compile({ ...opts, name: "orchestrator" }),
    action: buildHumanAgent().compile({ ...opts, name: "human_agent" }),
    approval: buildApprovalAgent().compile({ ...opts, name: "approval_agent" }),
    payment: buildTreasuryAgent().compile({ ...opts, name: "treasury_agent" }),
    call: buildVoiceAgent().compile({ ...opts, name: "voice_agent" }),
    rsvp: buildRsvpAgent().compile({ ...opts, name: "rsvp_agent" }),
  };
}

let graphs = compileAll(new MemorySaver());

interface Thread {
  graph: GraphName;
  requestId: string;
  parent?: string;
  stepId?: string;
  done?: boolean;
}

interface Paused {
  threadId: string;
  kind: Exclude<Waiting["kind"], "agents">;
  waitingOn: string[];
  summary: string;
  ask?: string;
  since: number;
  token: number;
  timer: NodeJS.Timeout;
}

const threads = new Map<string, Thread>();
const paused = new Map<string, Paused>();
const queues = new Map<string, Promise<unknown>>();
const requests = new Map<string, Request>();
let token = 0;
let seq = 0;

const config = (threadId: string) => ({ configurable: { thread_id: threadId }, recursionLimit: 200 });

/** Serialize runs per thread so two inputs can't resume the same thread at once. */
function enqueue(threadId: string, job: () => Promise<void>): Promise<void> {
  const next = (queues.get(threadId) ?? Promise.resolve()).then(job, job);
  queues.set(threadId, next.catch(() => {}));
  return next;
}

async function run(threadId: string, input: unknown): Promise<void> {
  const thread = threads.get(threadId);
  if (!thread || thread.done) return;
  clearPause(threadId);
  const graph = graphs[thread.graph] as { invoke: (i: unknown, c: unknown) => Promise<Record<string, unknown>> };
  let out: Record<string, unknown>;
  try {
    out = await graph.invoke(input, config(threadId));
  } catch (err) {
    console.error(`[runner] ${threadId} failed`, err);
    emit("error", "agent", { thread: threadId, message: err instanceof Error ? err.message : String(err) }, { request_id: thread.requestId });
    if (thread.parent) finishAgent(thread, { status: "failed", summary: `Agent crashed: ${err instanceof Error ? err.message : err}` });
    return;
  }

  if (isInterrupted<Waiting>(out)) {
    const waiting = out[INTERRUPT][0].value!;
    if (waiting.kind === "agents") waiting.spawn.forEach((l) => spawnAgent(threadId, thread.requestId, l));
    else pause(threadId, waiting);
    return;
  }

  thread.done = true;
  if (thread.parent) finishAgent(thread, (out.result as StepResult | null) ?? { status: "failed", summary: "Agent ended without a result" });
  else cancelChildren(threadId);
}

function spawnAgent(parent: string, requestId: string, { request, step, briefing }: Launch) {
  const threadId = `${parent}/${step.id}${step.attempts ? `#${step.attempts}` : ""}`;
  if (threads.has(threadId)) return;
  threads.set(threadId, { graph: step.kind, requestId, parent, stepId: step.id });
  emit("agent_spawned", "agent", { thread: threadId, agent: step.kind, step: step.id }, { request_id: requestId });
  requests.set(requestId, request); // now carries the orchestrator's title / task type
  void enqueue(threadId, () => run(threadId, { request, step, briefing }));
}

function finishAgent(thread: Thread, result: StepResult) {
  thread.done = true;
  void resume(thread.parent!, { type: "agent_result", step_id: thread.stepId!, result });
}

/** The request ended: stop any agents still waiting on people. */
function cancelChildren(parent: string) {
  for (const [id, t] of threads) {
    if (t.parent === parent && !t.done) {
      t.done = true;
      clearPause(id);
      emit("agent_cancelled", "agent", { thread: id }, { request_id: t.requestId });
    }
  }
}

function pause(threadId: string, waiting: Exclude<Waiting, { kind: "agents" }>) {
  const t = ++token;
  const timer = setTimeout(() => {
    if (paused.get(threadId)?.token === t) void resume(threadId, { type: "timeout" });
  }, env.reminderMs);
  timer.unref();
  paused.set(threadId, { ...waiting, threadId, since: Date.now(), token: t, timer });
}

function clearPause(threadId: string) {
  const p = paused.get(threadId);
  if (p) clearTimeout(p.timer);
  paused.delete(threadId);
}

export function startRequest(requester: string, goal: string): Promise<string> {
  const id = `req_live_${String(++seq).padStart(3, "0")}`;
  const request: Request = { id, requester, goal };
  requests.set(id, request);
  threads.set(id, { graph: "orchestrator", requestId: id });
  return enqueue(id, () => run(id, { request })).then(() => id);
}

export function resume(threadId: string, payload: Resume): Promise<void> {
  return enqueue(threadId, () => run(threadId, new Command({ resume: payload })));
}

/** Paused threads waiting on this person, oldest first. */
export function waitingOn(personId: string): Paused[] {
  return [...paused.values()].filter((p) => p.waitingOn.includes(personId)).sort((a, b) => a.since - b.since);
}

export function allPaused(): Paused[] {
  return [...paused.values()];
}

/** Resolves once every queued run, including agents they spawned, has settled. */
export async function idle(): Promise<void> {
  for (;;) {
    const pending = [...queues.values()];
    await Promise.all(pending);
    await new Promise((r) => setTimeout(r, 20));
    if ([...queues.values()].every((q) => pending.includes(q))) return;
  }
}

export async function snapshot(requestId: string): Promise<OState | undefined> {
  const snap = await graphs.orchestrator.getState(config(requestId));
  return snap?.values as OState | undefined;
}

export function listRequests(): Request[] {
  return [...requests.values()].map((r) => ({ ...r }));
}

export function resetRunner() {
  for (const id of paused.keys()) clearPause(id);
  threads.clear();
  requests.clear();
  queues.clear();
  graphs = compileAll(new MemorySaver());
}
