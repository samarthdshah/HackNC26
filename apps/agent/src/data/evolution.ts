// Darwin Growth, live: each generation's champion rule set is a fruit on the Darwin page.
// An admin approves a generation (the agent routes by its rules) or rejects it (the fruit falls).
//
// Decisions are ordinary events, recorded with emit() like every other side effect:
//   darwin_generation_approved | darwin_generation_rejected, actor "admin",
//   payload { gen, decision, rule_ids, run_id }
// so they land in Tiger (as wayfinder_agent), logs/events.jsonl and the /live stream.
// Reading them back: Tiger's events_public as wayfinder_web when TIGER_WEB_PASSWORD is set,
// else a fold over logs/events.jsonl. Latest decision per generation wins.
//
// Darwin keeps rule approvals only in memory, so after every decision, and whenever Darwin's
// run id changes (it restarted or re-evolved), the union of approved generations' rules is
// pushed to Darwin's /rules/{id}/approve|reject. That is what the agent's /route-hint reads.
// Adapted from CodeRockerr's version7 evolution.ts.

import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import type { DarwinDecision, DarwinGeneration, DarwinView } from "@wayfinder/shared";
import { env } from "../env.ts";
import { emit } from "../events.ts";
import { logFile } from "../logs.ts";
import { tigerConfigured } from "./tiger.ts";

interface StoredDecision {
  gen: number;
  decision: DarwinDecision;
  rule_ids: string[];
  at: string;
}

type DarwinRule = { id: string; text: string; status: string };
type DarwinRun = {
  run_id: string;
  replayed: number;
  baseline: { fitness: number; avg_hops: number; requests: number };
  best: { fitness: number; rules: DarwinRule[] };
  generations: { gen: number; best_fitness: number; best_rule_ids: string[] }[];
};
type GenBase = Omit<DarwinGeneration, "status" | "decidedAt">;

export class DarwinHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

// ── Darwin HTTP ────────────────────────────────────────────────────────────

async function darwin<T>(path: string, init?: RequestInit): Promise<T> {
  if (!env.darwinUrl) throw new DarwinHttpError(503, "DARWIN_URL is not set");
  let res: Response;
  try {
    res = await fetch(new URL(path, env.darwinUrl), { ...init, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    throw new DarwinHttpError(502, `Darwin not reachable at ${env.darwinUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new DarwinHttpError(res.status === 404 ? 404 : 502, `Darwin ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Rule ids carry the rule: "entry:<task>:<to>[@sev1+sev2]" or "skip:<task>:<avoid>><use>" (services/darwin/replay.py). */
function specOf(id: string) {
  const [kind, task_type, target = ""] = id.split(":");
  if (kind === "entry") {
    const [to, sev] = target.split("@");
    return { kind, task_type, to, ...(sev ? { when: { severity: sev.split("+") } } : {}) };
  }
  const [avoid, use] = target.split(">");
  return { kind, task_type, avoid, use };
}

function fallbackText(id: string) {
  const s = specOf(id), task = s.task_type.replace(/_/g, " ");
  return "to" in s ? `${task} → ${s.to}` : `${task}: skip ${s.avoid}, go to ${s.use}`;
}

// ── decisions ──────────────────────────────────────────────────────────────

const EVENT = { approved: "darwin_generation_approved", rejected: "darwin_generation_rejected" } as const;
const TYPES: string[] = Object.values(EVENT);

let reader: pg.Pool | undefined;
function tigerReader(): pg.Pool | undefined {
  if (!tigerConfigured() || !env.tiger.webPassword) return undefined;
  if (reader) return reader;
  const url = new URL(env.tiger.url);
  url.searchParams.delete("sslmode");
  url.username = "wayfinder_web";
  url.password = encodeURIComponent(env.tiger.webPassword);
  reader = new pg.Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: !env.tiger.insecureTls }, max: 2, connectionTimeoutMillis: 8000 });
  reader.on("error", (e) => console.warn(`[evolution] tiger: ${e.message}`));
  return reader;
}

export const decisionStore = (): "tiger" | "local" => (tigerReader() ? "tiger" : "local");

async function fromTiger(db: pg.Pool): Promise<Map<number, StoredDecision>> {
  const { rows } = await db.query(
    `select distinct on ((payload->>'gen')::int) (payload->>'gen')::int as gen, type, payload, ts
       from events_public where type = any($1)
      order by (payload->>'gen')::int, ts desc`,
    [TYPES],
  );
  return new Map(rows.map((r) => [r.gen as number, {
    gen: r.gen,
    decision: r.type === EVENT.approved ? "approved" : "rejected",
    rule_ids: (r.payload?.rule_ids as string[]) ?? [],
    at: new Date(r.ts).toISOString(),
  } satisfies StoredDecision]));
}

function fromLog(): Map<number, StoredDecision> {
  const out = new Map<number, StoredDecision>();
  const file = logFile("events.jsonl");
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes("darwin_generation_")) continue;
    try {
      const e = JSON.parse(line);
      if (!TYPES.includes(e.type)) continue;
      const gen = Number(e.payload?.gen);
      if (!Number.isInteger(gen)) continue;
      const prev = out.get(gen);
      if (prev && prev.at > e.ts) continue;
      out.set(gen, { gen, decision: e.type === EVENT.approved ? "approved" : "rejected", rule_ids: e.payload?.rule_ids ?? [], at: e.ts });
    } catch { /* a torn line */ }
  }
  return out;
}

async function listDecisions(): Promise<Map<number, StoredDecision>> {
  const db = tigerReader();
  if (db) {
    try { return await fromTiger(db); } catch (err) {
      console.warn(`[evolution] reading decisions from Tiger failed, using events.jsonl: ${(err as Error).message}`);
    }
  }
  return fromLog();
}

// ── the tree ───────────────────────────────────────────────────────────────

const genCache = new Map<string, GenBase[]>();
let syncedRun: string | null = null;
/** Decisions this process made, merged over reads: emit's Tiger write is queued, so a read can lag. */
const recent = new Map<number, StoredDecision>();

async function generations(run: DarwinRun): Promise<GenBase[]> {
  const cached = genCache.get(run.run_id);
  if (cached) return cached;
  const texts = new Map(run.best.rules.map((r) => [r.id, r.text]));
  const span = run.baseline.fitness - run.best.fitness || 1;
  const list = await Promise.all(run.generations.map(async (g) => {
    // Average hops this generation's champion gets when Darwin replays history with it.
    const out = await darwin<{ score: { avg_hops: number } }>("/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules: g.best_rule_ids.map(specOf) }),
    });
    return {
      gen: g.gen + 1, // 1-based, as the page shows it
      avgHops: out.score.avg_hops,
      fitness: Math.max(0, Math.min(1, (run.baseline.fitness - g.best_fitness) / span)),
      rules: g.best_rule_ids.length,
      ruleIds: g.best_rule_ids,
      ruleTexts: g.best_rule_ids.map((id) => texts.get(id) ?? fallbackText(id)),
    };
  }));
  genCache.clear(); // only the latest run matters
  genCache.set(run.run_id, list);
  return list;
}

async function decisions(): Promise<Map<number, StoredDecision>> {
  const stored = await listDecisions();
  for (const [gen, d] of recent) {
    const s = stored.get(gen);
    if (!s || s.at < d.at) stored.set(gen, d);
    else recent.delete(gen); // the read has caught up
  }
  return stored;
}

/** Push the decisions into Darwin's rule approvals (what /route-hint reads). */
async function sync(run: DarwinRun, gens: GenBase[], decided: Map<number, StoredDecision>) {
  const approved = new Set<string>(), rejected = new Set<string>();
  for (const g of gens) {
    const d = decided.get(g.gen)?.decision;
    if (d === "approved") g.ruleIds.forEach((id) => approved.add(id));
    else if (d === "rejected") g.ruleIds.forEach((id) => rejected.add(id));
  }
  for (const rule of run.best.rules) {
    // On if any approved generation carries it; off if only rejected ones do.
    const want = approved.has(rule.id) ? "approved" : rejected.has(rule.id) ? "rejected" : null;
    if (!want || rule.status === want) continue;
    await darwin(`/rules/${encodeURIComponent(rule.id)}/${want === "approved" ? "approve" : "reject"}`, { method: "POST" });
    rule.status = want;
  }
  syncedRun = run.run_id;
}

const offline = (): DarwinView => ({ connected: false, replayed: 0, generations: [] });

/** Everything the Darwin page needs; re-applies decisions when Darwin's run changed (e.g. it restarted). */
export async function view(): Promise<DarwinView> {
  if (!env.darwinUrl) return offline();
  try {
    const run = await darwin<DarwinRun>("/runs/latest");
    const [gens, decided] = await Promise.all([generations(run), decisions()]);
    if (syncedRun !== run.run_id) await sync(run, gens, decided);
    return {
      connected: true,
      replayed: run.replayed ?? run.baseline.requests,
      generations: gens.map((g) => {
        const d = decided.get(g.gen);
        return { ...g, status: d?.decision ?? "proposed", decidedAt: d?.at ?? null };
      }),
    };
  } catch (err) {
    console.warn(`[evolution] ${(err as Error).message}`);
    return offline();
  }
}

/** Approve or reject one generation: record the event, then update Darwin's rule approvals. */
export async function decide(gen: number, decision: DarwinDecision) {
  const run = await darwin<DarwinRun>("/runs/latest");
  const gens = await generations(run);
  const g = gens.find((x) => x.gen === gen);
  if (!g) throw new DarwinHttpError(404, `No generation ${gen} in Darwin's latest run`);
  const event = emit(EVENT[decision], "admin", { gen, decision, rule_ids: g.ruleIds, run_id: run.run_id });
  const stored: StoredDecision = { gen, decision, rule_ids: g.ruleIds, at: event.ts };
  recent.set(gen, stored);
  const decided = await decisions();
  decided.set(gen, stored);
  await sync(run, gens, decided);
  return {
    ok: true,
    gen,
    status: decision,
    event_id: event.id,
    store: decisionStore(),
    rules: run.best.rules.filter((r) => g.ruleIds.includes(r.id)).map((r) => ({ id: r.id, status: r.status })),
  };
}
