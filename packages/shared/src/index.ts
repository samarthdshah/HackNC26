// DRAFT: review with lanes A and B
// Shared contracts. Python mirrors: services/darwin/models.py. Change both together.

/** Gemini function names the agent can call. */
export type ToolName =
  | "plan"
  | "route"
  | "check_permission"
  | "draft"
  | "pay"
  | "call"
  | "match";

export const TOOL_NAMES: readonly ToolName[] = [
  "plan",
  "route",
  "check_permission",
  "draft",
  "pay",
  "call",
  "match",
] as const;

/** One edge in the org map: who handles which kind of task. */
export interface OrgEdge {
  from: string; // person or team id
  to: string; // person or team id
  task_type: string;
  confidence: number; // 0..1
  source: "chart" | "learned";
  delegate_until?: string; // ISO 8601, set when `to` is a temporary delegate
}

/** One logged event. A writes, C stores, B renders. */
export interface Event {
  id: string;
  ts: string; // ISO 8601
  type: string; // e.g. "request_created", "routed", "bounced", "approved", "resolved"
  actor: string; // person, team, or "agent"
  request_id?: string;
  tool?: ToolName;
  payload: Record<string, unknown>;
}

/** What the website receives when anything changes. */
export type LiveUpdate =
  | { kind: "event"; ts: string; data: Event }
  | { kind: "edge"; ts: string; data: OrgEdge };

// ---------------------------------------------------------------------------
// Tool signatures (Lane A owns the agent side; Lane C can build data sides
// such as check_permission against these without waiting on the agent).

/** Which specialist agent runs a step. */
export type StepKind = "action" | "approval" | "payment" | "call" | "rsvp" | "room";

export interface PlanStep {
  id: string;
  kind: StepKind;
  task_type: string;
  description: string;
  depends_on: string[]; // step ids that must finish first; independent steps run in parallel
  amount_usd?: number;
  vendor_id?: string; // payment / call
  to_department?: string; // internal budget transfer
  audience?: string; // rsvp: team name or comma-separated people
}

/** What a specialist agent hands back to the orchestrator. */
export interface StepResult {
  status: "done" | "denied" | "failed";
  summary: string;
  owner?: string;
  data?: Record<string, unknown>; // e.g. { headcount: 7 } or { tx: "...", explorer_url: "..." }
}

export interface ToolIO {
  plan: {
    input: { goal: string; requester: string; task_type?: string; amount_usd?: number };
    output: { steps: PlanStep[] };
  };
  route: {
    input: { task_type: string; requester: string; exclude?: string[]; prefer?: string };
    output: {
      owner: string | null; // person id who should act
      entry: string | null; // first hop the agent chose (team or person)
      chain: string[]; // entry ... owner
      confidence: number;
      source: OrgEdge["source"];
      delegated_from?: string; // set when owner is covering for someone who is out
    };
  };
  check_permission: {
    input: { person: string; action: string; amount_usd?: number };
    output: { allowed: boolean; approvers: string[]; reason: string; budget_id?: string; remaining_usd?: number };
  };
  draft: {
    input: { to: string; intent: string; context?: string };
    output: { text: string };
  };
  pay: {
    input: { from: string; to: string; amount_usd: number; memo: string; rail: "nessie" | "solana" };
    output: { tx_id: string; rail: string; receipt_url?: string; simulated?: boolean };
  };
  call: {
    input: { to: string; purpose: string; script_context: string };
    output: { call_id: string; summary: string; outcome: string };
  };
  match: {
    input: { need: string; person: string };
    output: { candidates: { person: string; score: number; reason: string }[] };
  };
}
