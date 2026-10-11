// The self-learning org map. Starts from Lane C's chart edges and learns from
// what actually happens: redirects, delegations and successful handoffs.
// Persisted to logs/edges.json and, when Tiger is ready, to Lane C's org_edges with
// one org_edge_changes row per change (previous confidence, reason, request).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { logFile } from "../logs.ts";
import type { OrgEdge } from "@wayfinder/shared";
import { edges as chartEdges } from "../data/fixtures.ts";
import { readEdges, type EdgeChange } from "../data/tiger.ts";
import { emitEdge } from "../events.ts";

const file = logFile("edges.json");

const sameHop = (a: OrgEdge, b: OrgEdge) => a.from === b.from && a.to === b.to && a.task_type === b.task_type;

/** Saved map (with what it learned) plus any chart edges added since it was saved. */
function load(): OrgEdge[] {
  if (!existsSync(file)) return structuredClone(chartEdges);
  const saved = JSON.parse(readFileSync(file, "utf8")) as OrgEdge[];
  return [...saved, ...chartEdges.filter((c) => !saved.some((s) => sameHop(s, c)))];
}

let edges: OrgEdge[] = load();

const save = () => writeFileSync(file, JSON.stringify(edges, null, 1));
const clamp = (n: number) => Math.round(Math.min(0.99, Math.max(0.05, n)) * 100) / 100;

/** Usable for routing: not an expired delegation, and not zeroed out by /reset. */
export const isActive = (e: OrgEdge, now = new Date()) =>
  e.confidence > 0 && (!e.delegate_until || new Date(e.delegate_until) > now);

export function allEdges(): readonly OrgEdge[] {
  return edges;
}

export function edgesFrom(from: string, taskType: string): OrgEdge[] {
  return edges
    .filter((e) => e.from === from && e.task_type === taskType && isActive(e))
    .sort((a, b) => b.confidence - a.confidence);
}

export const taskTypes = () => [...new Set(edges.map((e) => e.task_type))].sort();

function upsert(edge: OrgEdge, reason: EdgeChange["reason"], requestId?: string): OrgEdge {
  const i = edges.findIndex((e) => sameHop(e, edge));
  const previous = i >= 0 ? edges[i].confidence : null;
  if (i >= 0) edges[i] = edge;
  else edges.push(edge);
  save();
  emitEdge(edge, { previous, reason, requestId });
  return edge;
}

function find(from: string, to: string, taskType: string) {
  return edges.find((e) => e.from === from && e.to === to && e.task_type === taskType);
}

/** Nudge confidence on an existing edge (no-op when the edge doesn't exist). */
export function adjust(
  from: string,
  to: string,
  taskType: string,
  delta: number,
  reason: EdgeChange["reason"],
  requestId?: string,
): OrgEdge | undefined {
  const edge = find(from, to, taskType);
  if (!edge || (delta > 0 && edge.confidence >= 0.99)) return edge;
  return upsert({ ...edge, confidence: clamp(edge.confidence + delta) }, reason, requestId);
}

/** "Not us, try X": demote the hop that bounced, learn a direct hop to X. */
export function learnRedirect(from: string, wrong: string, right: string, taskType: string, requestId?: string) {
  const demoted = adjust(from, wrong, taskType, -0.3, "redirected", requestId);
  const existing = find(from, right, taskType);
  const top = edgesFrom(from, taskType)[0]?.confidence ?? 0.5;
  const learned = upsert({
    from,
    to: right,
    task_type: taskType,
    confidence: clamp(Math.max(existing?.confidence ?? 0, top + 0.05, 0.75)),
    source: "learned",
  }, "redirected", requestId);
  return { demoted, learned };
}

/** "Ask Tom while I'm out": a temporary edge from the person to their delegate. */
export function learnDelegate(person: string, delegate: string, taskType: string, until?: string, requestId?: string) {
  const fallback = new Date(Date.now() + 7 * 864e5).toISOString();
  return upsert({
    from: person,
    to: delegate,
    task_type: taskType,
    confidence: 1,
    source: "learned",
    delegate_until: until ?? fallback,
  }, "delegated", requestId);
}

/** A handoff chain worked end to end: strengthen every hop on it. */
export function reinforce(chain: string[], taskType: string, requestId?: string) {
  const path = ["agent", ...chain];
  for (let i = 0; i < path.length - 1; i++) adjust(path[i], path[i + 1], taskType, 0.05, "reinforced", requestId);
}

/** Tiger's org_edges is the shared source of truth once it has rows; adopt it at startup. */
export async function syncMapFromTiger(): Promise<"tiger" | "local"> {
  const remote = await readEdges();
  if (!remote) return "local";
  edges = [...remote, ...chartEdges.filter((c) => !remote.some((r) => sameHop(r, c)))];
  save();
  return "tiger";
}

/**
 * /reset: back to the chart. The agent's Tiger login can't delete rows, so learned
 * edges are zeroed (inactive) and chart edges get their chart confidence back, each
 * with a "reset" change row. A full wipe is Lane C's `tiger:seed`.
 */
export function resetMap() {
  const before = edges;
  edges = structuredClone(chartEdges);
  save();
  for (const e of before) {
    const chart = chartEdges.find((c) => sameHop(c, e));
    if (!chart && e.confidence > 0) emitEdge({ ...e, confidence: 0 }, { previous: e.confidence, reason: "reset" });
    if (chart && (chart.confidence !== e.confidence || chart.delegate_until !== e.delegate_until)) {
      emitEdge(chart, { previous: e.confidence, reason: "reset" });
    }
  }
}
