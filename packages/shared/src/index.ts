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
