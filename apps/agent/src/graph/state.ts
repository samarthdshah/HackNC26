// State for the orchestrator (one thread per request) and the specialist agents
// (one thread per step). Agents get the request, their step, and a briefing built
// from the results of the steps they depend on.

import { Annotation } from "@langchain/langgraph";
import type { PlanStep, StepResult, ToolIO } from "@wayfinder/shared";
import type { Reply } from "../brain/classify.ts";

export interface Request {
  id: string;
  requester: string;
  goal: string;
  title?: string;
  task_type?: string;
  amount_usd?: number;
}

export interface Step extends PlanStep {
  status: "pending" | "running" | "done" | "denied" | "failed" | "skipped";
  owner?: string;
  result?: StepResult;
  attempts?: number;
}

/** What a paused thread hands back. People-facing waits are indexed by person. */
export type Waiting =
  | { kind: "owner" | "approval" | "clarify" | "rsvp"; waitingOn: string[]; summary: string; ask?: string }
  | { kind: "agents"; waitingOn: []; summary: string; spawn: Launch[] };

/** A step handed to a specialist agent, with what its dependencies produced. */
export interface Launch {
  request: Request;
  step: Step;
  briefing: string;
}

/** What the runner feeds back in to resume a paused thread. */
export type Resume =
  | { type: "reply"; from: string; text: string }
  | { type: "timeout" }
  | { type: "agent_result"; step_id: string; result: StepResult };

export const last = <T>(fallback: T) => Annotation<T>({ reducer: (_, next) => next, default: () => fallback });
const append = <T>() => Annotation<T[]>({ reducer: (a, b) => a.concat(b), default: () => [] });

// ── orchestrator ────────────────────────────────────────────────────────────

export const OrchestratorState = Annotation.Root({
  request: Annotation<Request>,
  steps: last<Step[]>([]),
  critique: last<string[]>([]),
  launch: last<Launch[]>([]),
  planRounds: last<number>(0),
  incoming: last<Resume | null>(null),
  outcome: last<"open" | "done" | "denied" | "stuck">("open"),
  log: append<string>(),
});

export type OState = typeof OrchestratorState.State;
export type OUpdate = typeof OrchestratorState.Update;

// ── specialist agents ───────────────────────────────────────────────────────

/** Fields every specialist agent thread starts with and ends with. */
export const agentBase = {
  request: Annotation<Request>,
  step: Annotation<Step>,
  briefing: last<string>(""), // results of dependencies, in plain text
  incoming: last<Resume | null>(null),
  verdict: last<Reply | null>(null),
  result: last<StepResult | null>(null),
};

export interface Assignment extends Omit<ToolIO["route"]["output"], "owner"> {
  owner: string;
  ask?: string;
  reminders: number;
}

export interface Approval {
  approvers: string[];
  index: number;
  reason: string;
  amount_usd: number;
  ask?: string;
  reminders: number;
}
