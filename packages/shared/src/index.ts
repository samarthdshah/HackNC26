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

/** Event types the agent emits (apps/agent/src/events.ts callers). Open-ended: new types may appear. */
export type AgentEventType =
  | "request_created" | "hop" | "routed" | "redirected" | "delegated" | "step_done"
  | "approval_requested" | "approved" | "denied" | "payment_sent"
  | "request_resolved" | "request_denied" | "request_stuck"
  | "message_in" | "message_out" | "reply_in" | "intro_sent"
  | "rsvp_opened" | "rsvp_received" | "rsvp_closed" | "call_started" | "call_ended"
  | "room_checked" | "booking_released" | "darwin_hint" | "reminder_sent" | "escalated"
  | "plan_created" | (string & {});

/** One logged event. A writes, C stores, B renders. */
export interface Event {
  id: string;
  ts: string; // ISO 8601
  type: AgentEventType;
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
    input: { person: string; action: string; amount_usd?: number; to_department?: string }; // to_department: a budget transfer (POL-SPEND-2)
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

// ---------------------------------------------------------------------------
// Records as stored in Tiger (data/tiger/SCHEMA.md) and data/fixtures, with
// API names (from/to, start/end). Tiger's from_id/to_id/start_at/end_at are
// mapped in the readers.

/** HR request types: text is masked outside HR (same rule in Tiger and Snowflake). */
export const HR_TASK_TYPES = ["leave_request", "benefits_question", "employee_relations"] as const;
export const HR_PLACEHOLDER = "[visible to HR only]";

export type RequestStatus = "open" | "resolved" | "denied" | "stuck";
/** What a hop's receiver did with the request. */
export type HopOutcome = "pending" | "forwarded" | "bounced" | "delegated" | "handled";

export interface Actor {
  id: string; // dept_*, p_*, or "agent"
  kind: "department" | "person" | "agent";
  name: string;
  department_id: string | null; // self for departments
}

export interface Request {
  id: string;
  task_type: string;
  title: string;
  requester_id: string;
  created_at: string;
  status: RequestStatus;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  severity?: string | null;
  new_hire_name?: string | null;
  new_hire_id?: string | null;
  room_id?: string | null;
  vendor_id?: string | null;
  amount_usd?: number | null;
  hr_sensitive: boolean;
  origin: "seed" | "agent";
}

export interface Hop {
  request_id: string;
  seq: number;
  from: string;
  to: string;
  at: string; // when `to` received it
  outcome: HopOutcome;
  redirect_to?: string | null;
  note: string | null;
}

export interface Booking {
  id: string;
  room_id: string;
  booked_by: string;
  title: string;
  start: string;
  end: string;
  attendees_expected: number | null;
  status: "confirmed" | "partially_used" | "released" | "cancelled";
  used_until: string | null;
  note: string | null;
  released_at?: string | null;
}

/** One row of org_edge_changes: an edge the agent created or changed. */
export interface OrgEdgeChange extends OrgEdge {
  changed_at: string;
  previous_confidence: number | null;
  reason?: string | null;
  request_id?: string | null;
}

// ---------------------------------------------------------------------------
// Agent HTTP API for the website (apps/agent/src/server.ts).

/** POST /say: the website speaks as a person, as if they had texted. */
export interface SayRequest {
  as: string; // person id
  text: string;
  request_id?: string; // resume this request's waiting step if the person owes it a reply
  mirror?: boolean; // also text the reply to the person's phone
}
export interface SayResponse {
  ok: boolean;
  person: string;
  route: "resume" | "start" | "reply" | "none"; // reply: answered directly (question or chat)
  request_id?: string;
  reply?: string;
}

/** POST /intro: Lagoon's Introduce button. */
export interface IntroRequest { a: string; b: string; why: string; topic: string; by?: string }
export interface IntroResponse { ok: boolean; group: string; virtual: boolean; event_id: string }

/** POST /summary: a short spoken-style summary of one request (Currents' Summary button). */
export interface SummaryRequest {
  request_id?: string;
  title: string;
  status: string;
  requester?: string; // display name
  steps: { who: string; kind: string; text: string; at?: string }[]; // the request's transactions, oldest first
}
export interface SummaryResponse { ok: boolean; text: string }

/** First SSE message on GET /live. boot_id changes when the agent restarts. */
export interface LiveHello { boot_id: string; bound: string[] }

export * from "./wf";
