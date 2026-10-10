// Runs every graph thread: one orchestrator thread per request, one specialist
// agent thread per step. Agents are spawned here, outside any graph run, from
// the orchestrator's interrupt payload (spawning inside a node would turn the
// agent into a subgraph and its interrupts would bubble into the orchestrator).
// When an agent finishes, its result resumes the orchestrator.
//
// Also tracks which people each paused thread waits on, so inbound texts find
// their thread, and arms reminder timers.
//
// Durable: graph state is checkpointed to SQLite and the runner's own registry
// to logs/runner.json, so restore() picks every request back up after a restart.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
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

const dbFile = fileURLToPath(new URL("../../logs/checkpoints.sqlite", import.meta.url));
const registryFile = fileURLToPath(new URL("../../logs/runner.json", import.meta.url));

function compileAll() {
  const checkpointer = SqliteSaver.fromConnString(dbFile);
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

let graphs = compileAll();

interface Thread {
  graph: GraphName;
  requestId: string;
  parent?: string;
  stepId?: string;
  done?: boolean;
}

type PausedInfo = Exclude<Waiting, { kind: "agents" }> & { since: number };
interface Paused extends PausedInfo {
  threadId: string;
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

// ── registry persistence ───────────────────────────────────────────────────

function save() {
  const pausedInfo = [...paused.values()].map(({ threadId, token: _t, timer: _x, ...info }) => [threadId, info]);
  writeFileSync(
    registryFile,
    JSON.stringify({ seq, threads: [...threads], requests: [...requests], paused: pausedInfo }, null, 1),
  );
}

/** Reload the registry after a restart: re-arm reminders, finish interrupted runs. */
export async function restore(): Promise<{ requests: number; waiting: number; resumed: number }> {
  if (!existsSync(registryFile)) return { requests: 0, waiting: 0, resumed: 0 };
  const saved = JSON.parse(readFileSync(registryFile, "utf8")) as {
    seq: number;
    threads: [string, Thread][];
    requests: [string, Request][];
    paused: [string, PausedInfo][];
  };
  seq = saved.seq;
  saved.threads.forEach(([id, t]) => threads.set(id, t));
  saved.requests.forEach(([id, r]) => requests.set(id, r));
  saved.paused.forEach(([id, info]) => pause(id, info, info.since));

  // A thread that was mid-run when we stopped (not paused, not finished) continues
  // from its last checkpoint. Orchestrators parked on their agents need nothing.
  let resumed = 0;
  for (const [id, t] of threads) {
    if (t.done || paused.has(id)) continue;
    const snap = await graphs[t.graph].getState(config(id));
    const parked = snap.tasks.some((task) => task.interrupts.length > 0);
    if (!parked && snap.next.length > 0) {
      resumed++;
      void enqueue(id, () => run(id, null));
    }
  }
  return { requests: requests.size, waiting: paused.size, resumed };
}

// ── running threads ────────────────────────────────────────────────────────

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
    save();
    return;
  }

  if (isInterrupted<Waiting>(out)) {
    const waiting = out[INTERRUPT][0].value!;
    if (waiting.kind === "agents") waiting.spawn.forEach((l) => spawnAgent(threadId, thread.requestId, l));
    else pause(threadId, waiting);
    save();
    return;
  }

  thread.done = true;
  if (thread.parent) finishAgent(thread, (out.result as StepResult | null) ?? { status: "failed", summary: "Agent ended without a result" });
  else cancelChildren(threadId);
  save();
}

function spawnAgent(parent: string, requestId: string, { request, step, briefing }: Launch) {
  const threadId = `${parent}/${step.id}${step.attempts ? `#${step.attempts}` : ""}`;
  if (threads.has(threadId)) return;
  threads.set(threadId, { graph: step.kind, requestId, parent, stepId: step.id });
  requests.set(requestId, request); // now carries the orchestrator's title / task type
  emit("agent_spawned", "agent", { thread: threadId, agent: step.kind, step: step.id }, { request_id: requestId });
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

function pause(threadId: string, waiting: Exclude<Waiting, { kind: "agents" }>, since = Date.now()) {
  const t = ++token;
  const timer = setTimeout(() => {
    if (paused.get(threadId)?.token === t) void resume(threadId, { type: "timeout" });
  }, env.reminderMs);
  timer.unref();
  paused.set(threadId, { ...waiting, threadId, since, token: t, timer });
}

function clearPause(threadId: string) {
  const p = paused.get(threadId);
  if (p) clearTimeout(p.timer);
  paused.delete(threadId);
}

// ── public API ─────────────────────────────────────────────────────────────

export function startRequest(requester: string, goal: string): Promise<string> {
  // Unique across resets and restarts: these ids are primary keys in Tiger.
  const id = `req_live_${Date.now().toString(36)}${(++seq).toString(36)}`;
  const request: Request = { id, requester, goal };
  requests.set(id, request);
  threads.set(id, { graph: "orchestrator", requestId: id });
  save();
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

/** Like idle(), but gives up after `ms`. Used before triage so a reply that
 *  arrives while its thread is still mid-run isn't mistaken for small talk. */
export const settle = (ms: number) => Promise.race([idle(), new Promise((r) => setTimeout(r, ms))]);

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
  seq = 0;
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`, registryFile]) rmSync(f, { force: true });
  graphs = compileAll();
}
