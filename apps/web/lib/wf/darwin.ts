// Darwin page snapshot: the fallback when the agent can't reach Darwin (the live path is agent
// GET /darwin, see app/darwin/Darwin.tsx). A captured GET /runs/latest from fallback/darwin-run.json,
// produced by services/darwin/fixtures_run.py. Shapes follow services/darwin/schemas.py.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WF, WfGeneration, WfRule } from "@wayfinder/shared";

const FILE = () => join(process.cwd(), "lib/wf/fallback/darwin-run.json");

export function loadDarwinSnapshot(): Pick<WF, "darwin" | "rules" | "darwinSource"> {
  const file = FILE();
  if (!existsSync(file)) return { darwin: [], rules: [], darwinSource: "none" };
  try {
    return { ...normaliseRun(JSON.parse(readFileSync(file, "utf8"))), darwinSource: "snapshot" };
  } catch {
    return { darwin: [], rules: [], darwinSource: "none" };
  }
}

/* ---------- EvolveResult (schemas.py), only the fields the web reads ---------- */
interface Side { requests: number; hours: number; avg_hours: number; hops: number; avg_hops: number; bounces: number }
interface Totals { requests: number; hours: number; avg_hours: number; hops: number; avg_hops: number; bounces: number; fitness?: number | null }
interface Evidence { requests: number; hours_saved: number; hops_saved: number; bounces_avoided: number; before: Side; after: Side }
interface Rule { id: string; kind: "entry" | "skip"; task_type: string; text: string; status: "proposed" | "approved" | "rejected" | "frozen"; evidence?: Evidence | null }
interface Generation { gen: number; best_fitness: number; mean_fitness: number; best_rule_ids: string[] }
export interface EvolveResult {
  run_id: string;
  replayed: number;
  baseline: Totals;
  best: { fitness: number; score: Totals; rules: Rule[] };
  delta: { hours: number; pct_hours: number; hops: number; bounces: number };
  generations: Generation[];
  left_for_live_learning: Rule[];
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function saves(e?: Evidence | null) {
  if (!e) return "—";
  const parts = [`${round(e.hours_saved, 1)} h`];
  if (e.hops_saved) parts.push(`${e.hops_saved} ${e.hops_saved === 1 ? "hop" : "hops"}`);
  return parts.join(" · ");
}

/**
 * EvolveResult → the page's generations and rules.
 * - Gen 0 is the baseline replay (history as it happened, no rules). Darwin's generation k
 *   becomes Gen k+1, so the first ring reads "Replaying the old routes" as in v6.
 * - fitness: Darwin's is a cost (lower is better). Mapped to 0..1, 0 = baseline, 1 = best set found.
 * - avgHops: projected. Darwin only scores the best set, so a generation's hops are interpolated
 *   from baseline avg hops to best avg hops by its normalised fitness.
 * - rules: the best set (proposed / approved / rejected) plus the ones left for live learning (frozen).
 */
export function normaliseRun(raw: unknown): Pick<WF, "darwin" | "rules"> {
  const run = raw as EvolveResult;
  if (!run || !Array.isArray(run.generations) || !run.baseline || !run.best) return { darwin: [], rules: [] };
  const baseFit = run.baseline.fitness ?? run.generations[0]?.best_fitness ?? 0;
  const bestFit = run.best.fitness;
  const span = baseFit - bestFit;
  const norm = (f: number) => (span > 0 ? Math.min(1, Math.max(0, (baseFit - f) / span)) : 1);
  const h0 = run.baseline.avg_hops, h1 = run.best.score.avg_hops;

  const darwin: WfGeneration[] = [
    { gen: 0, fitness: 0, avgHops: h0, rules: 0 },
    ...run.generations.map((g) => {
      const fitness = round(norm(g.best_fitness));
      return { gen: g.gen + 1, fitness, avgHops: round(h0 + (h1 - h0) * fitness), rules: g.best_rule_ids.length };
    }),
  ];

  const firstGen = (id: string) => {
    const g = run.generations.find((x) => x.best_rule_ids.includes(id));
    return g ? g.gen + 1 : 0;
  };
  const toRule = (r: Rule, frozen: boolean): WfRule => ({
    id: r.id,
    gen: frozen ? 0 : firstGen(r.id),
    text: r.text,
    saves: saves(r.evidence),
    status: frozen ? "frozen" : r.status === "frozen" ? "frozen" : r.status,
    kind: r.kind,
    task_type: r.task_type,
  });
  const rules = [...run.best.rules.map((r) => toRule(r, false)), ...(run.left_for_live_learning ?? []).map((r) => toRule(r, true))];
  return { darwin, rules };
}

/** Run-level numbers the WF shape has no slot for (requests replayed, baseline vs best). */
export interface DarwinMeta {
  runId: string;
  replayed: number;
  baselineAvgHops: number;
  bestAvgHops: number;
  hoursSaved: number;
  pctHours: number;
  bouncesAvoided: number;
}

export function loadDarwinMeta(): DarwinMeta | null {
  const file = FILE();
  if (!existsSync(file)) return null;
  try {
    const run = JSON.parse(readFileSync(file, "utf8")) as EvolveResult;
    return {
      runId: run.run_id, replayed: run.replayed,
      baselineAvgHops: run.baseline.avg_hops, bestAvgHops: run.best.score.avg_hops,
      hoursSaved: run.delta.hours, pctHours: run.delta.pct_hours, bouncesAvoided: run.delta.bounces,
    };
  } catch {
    return null;
  }
}
