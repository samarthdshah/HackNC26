// The self-learning org map. Starts from Lane C's chart edges and learns from
// what actually happens: redirects, delegations and successful handoffs.
// Persisted to logs/edges.json so learning survives restarts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OrgEdge } from "@wayfinder/shared";
import { edges as chartEdges } from "../data/fixtures.ts";
import { readEdges, resetEdges } from "../data/tiger.ts";
import { emitEdge } from "../events.ts";

const file = fileURLToPath(new URL("../../logs/edges.json", import.meta.url));

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

export const isActive = (e: OrgEdge, now = new Date()) => !e.delegate_until || new Date(e.delegate_until) > now;

export function allEdges(): readonly OrgEdge[] {
  return edges;
}

export function edgesFrom(from: string, taskType: string): OrgEdge[] {
  return edges
    .filter((e) => e.from === from && e.task_type === taskType && isActive(e))
    .sort((a, b) => b.confidence - a.confidence);
}

export const taskTypes = () => [...new Set(edges.map((e) => e.task_type))].sort();

function upsert(edge: OrgEdge, learnedFrom?: string): OrgEdge {
  const i = edges.findIndex((e) => sameHop(e, edge));
  if (i >= 0) edges[i] = edge;
  else edges.push(edge);
  save();
  emitEdge(edge, learnedFrom);
  return edge;
}

function find(from: string, to: string, taskType: string) {
  return edges.find((e) => e.from === from && e.to === to && e.task_type === taskType);
}

/** Nudge confidence on an existing edge (no-op when the edge doesn't exist). */
export function adjust(from: string, to: string, taskType: string, delta: number): OrgEdge | undefined {
  const edge = find(from, to, taskType);
  if (!edge || (delta > 0 && edge.confidence >= 0.99)) return edge;
  return upsert({ ...edge, confidence: clamp(edge.confidence + delta) });
}

/** "Not us, try X": demote the hop that bounced, learn a direct hop to X. */
export function learnRedirect(from: string, wrong: string, right: string, taskType: string, requestId?: string) {
  const demoted = adjust(from, wrong, taskType, -0.3);
  const existing = find(from, right, taskType);
  const top = edgesFrom(from, taskType)[0]?.confidence ?? 0.5;
  const learned = upsert({
    from,
    to: right,
    task_type: taskType,
    confidence: clamp(Math.max(existing?.confidence ?? 0, top + 0.05, 0.75)),
    source: "learned",
  }, requestId);
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
  }, requestId);
}

/** A handoff chain worked end to end: strengthen every hop on it. */
export function reinforce(chain: string[], taskType: string) {
  const path = ["agent", ...chain];
  for (let i = 0; i < path.length - 1; i++) adjust(path[i], path[i + 1], taskType, 0.05);
}

/** Tiger's org_edges is the shared source of truth once it has rows; adopt it at startup. */
export async function syncMapFromTiger(): Promise<"tiger" | "local"> {
  const remote = await readEdges();
  if (!remote) return "local";
  edges = [...remote, ...chartEdges.filter((c) => !remote.some((r) => sameHop(r, c)))];
  save();
  return "tiger";
}

export function resetMap() {
  edges = structuredClone(chartEdges);
  save();
  resetEdges(chartEdges);
}
