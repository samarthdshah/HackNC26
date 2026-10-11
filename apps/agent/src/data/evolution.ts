// Darwin Growth: each generation's champion rule set is a fruit on the tree.
// An admin approves a generation (its fruit glows and the agent routes by its rules)
// or rejects it (the fruit falls). Decisions live in the database:
//   Tiger configured  → events `darwin_generation_approved|rejected`, inserted as
//                       wayfinder_agent and read back from events_public as wayfinder_web
//                       (C's events_derive trigger stores other event types untouched)
//   Tiger not set     → logs/darwin-decisions.json, so the page still works offline
// Darwin keeps rule approvals only in memory, so after every decision (and whenever
// Darwin restarts) the union of approved generations' rules is pushed to Darwin,
// which is what the agent's /route-hint reads.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { env } from "../env.ts";

export type Decision = "approved" | "rejected";
export type GenStatus = Decision | "proposed";

interface StoredDecision {
  gen: number;
  decision: Decision;
  rule_ids: string[];
  at: string;
}

type DarwinRule = { id: string; text: string; status: string; evidence?: { hours_saved: number; bounces_avoided: number } | null };
type DarwinRun = {
  run_id: string;
  baseline: { fitness: number; avg_hops: number; requests: number };
  best: { fitness: number; rules: DarwinRule[] };
  generations: { gen: number; best_fitness: number; best_rule_ids: string[] }[];
};

export interface GenerationFruit {
  gen: number; // 1-based, as shown on the page
  avgHops: number;
  fitness: number; // share of Darwin's best improvement this generation reached (0..1)
  rules: number;
  ruleIds: string[];
  ruleTexts: string[];
  status: GenStatus;
  decidedAt: string | null;
}

// ── Darwin HTTP ────────────────────────────────────────────────────────────

async function darwin<T>(path: string, init?: RequestInit): Promise<T> {
  if (!env.darwinUrl) throw new Error("DARWIN_URL is not set");
  const res = await fetch(new URL(path, env.darwinUrl), { ...init, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Darwin ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Rule ids carry the rule: "entry:<task>:<to>" or "skip:<task>:<avoid>><use>". */
function specOf(id: string) {
  const [kind, task_type, target] = id.split(":");
  if (kind === "entry") return { kind, task_type, to: target };
  const [avoid, use] = target.split(">");
  return { kind, task_type, avoid, use };
}

const fallbackText = (id: string) => {
  const s = specOf(id);
  return s.kind === "entry" ? `${s.task_type.replace(/_/g, " ")} → ${s.to}` : `${s.task_type.replace(/_/g, " ")}: skip ${s.avoid}, go to ${s.use}`;
};

// ── decision store ─────────────────────────────────────────────────────────

const EVENT = { approved: "darwin_generation_approved", rejected: "darwin_generation_rejected" } as const;
const localFile = fileURLToPath(new URL("../../logs/darwin-decisions.json", import.meta.url));

function tigerUrl(user: string, password: string) {
  const u = new URL(env.tiger.url);
  u.searchParams.delete("sslmode");
  u.username = user;
  u.password = encodeURIComponent(password);
  return u.toString();
}

export interface DecisionStore {
  kind: "tiger" | "local";
  list(): Promise<Map<number, StoredDecision>>;
  record(d: StoredDecision, runId: string): Promise<void>;
  close(): Promise<void>;
}

function localStore(): DecisionStore {
  const read = (): Record<string, StoredDecision> => (existsSync(localFile) ? JSON.parse(readFileSync(localFile, "utf8")) : {});
  return {
    kind: "local",
    async list() {
      return new Map(Object.values(read()).map((d) => [d.gen, d]));
    },
    async record(d) {
      writeFileSync(localFile, JSON.stringify({ ...read(), [d.gen]: d }, null, 1));
    },
    async close() {},
  };
}

function tigerStore(webPassword: string, agentPassword: string): DecisionStore {
  const ssl = { rejectUnauthorized: !env.tiger.insecureTls };
  const reader = new pg.Pool({ connectionString: tigerUrl("wayfinder_web", webPassword), ssl, max: 2, connectionTimeoutMillis: 8000 });
  const writer = new pg.Pool({ connectionString: tigerUrl("wayfinder_agent", agentPassword), ssl, max: 2, connectionTimeoutMillis: 8000 });
  for (const p of [reader, writer]) p.on("error", (e) => console.warn(`[evolution] tiger: ${e.message}`));
  return {
    kind: "tiger",
    async list() {
      // Latest decision per generation wins.
      const { rows } = await reader.query(
        `select distinct on ((payload->>'gen')::int) (payload->>'gen')::int as gen, type, payload, ts
           from events_public where type = any($1)
          order by (payload->>'gen')::int, ts desc`,
        [Object.values(EVENT)],
      );
      return new Map(
        rows.map((r) => [
          r.gen,
          {
            gen: r.gen,
            decision: r.type === EVENT.approved ? "approved" : "rejected",
            rule_ids: (r.payload.rule_ids as string[]) ?? [],
            at: new Date(r.ts).toISOString(),
          } satisfies StoredDecision,
        ]),
      );
    },
    async record(d, runId) {
      // The agent login can only insert events, so the id is generated here (no RETURNING).
      await writer.query(
        `insert into events (id, ts, type, actor, request_id, tool, payload) values ($1, $2, $3, 'admin', null, null, $4)`,
        [randomUUID(), d.at, EVENT[d.decision], JSON.stringify({ gen: d.gen, decision: d.decision, rule_ids: d.rule_ids, run_id: runId })],
      );
    },
    async close() {
      await Promise.allSettled([reader.end(), writer.end()]);
    },
  };
}

export function createDecisionStore(): DecisionStore {
  const web = process.env.TIGER_WEB_PASSWORD?.trim();
  const agent = process.env.TIGER_AGENT_PASSWORD?.trim();
  if (env.tiger.url && web && agent) return tigerStore(web, agent);
  if (env.tiger.url) console.warn("[evolution] TIGER_WEB_PASSWORD and TIGER_AGENT_PASSWORD are both needed; saving decisions locally");
  return localStore();
}

// ── the tree ───────────────────────────────────────────────────────────────

export class Evolution {
  private genCache = new Map<string, Omit<GenerationFruit, "status" | "decidedAt">[]>();
  private syncedRun: string | null = null;

  constructor(readonly store: DecisionStore) {}

  private async generations(run: DarwinRun, texts: Map<string, string>) {
    if (!this.genCache.has(run.run_id)) {
      const span = run.baseline.fitness - run.best.fitness || 1;
      const list = await Promise.all(
        run.generations.map(async (g) => {
          // Average hops this generation's champion gets when Darwin replays history with it.
          const out = await darwin<{ score: { avg_hops: number } }>("/replay", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ rules: g.best_rule_ids.map(specOf) }),
          });
          return {
            gen: g.gen + 1,
            avgHops: out.score.avg_hops,
            fitness: Math.max(0, Math.min(1, (run.baseline.fitness - g.best_fitness) / span)),
            rules: g.best_rule_ids.length,
            ruleIds: g.best_rule_ids,
            ruleTexts: g.best_rule_ids.map((id) => texts.get(id) ?? fallbackText(id)),
          };
        }),
      );
      this.genCache.set(run.run_id, list);
    }
    return this.genCache.get(run.run_id)!;
  }

  /** Push the decisions into Darwin's rule approvals (what the agent's route hints read). */
  private async sync(run: DarwinRun, gens: Omit<GenerationFruit, "status" | "decidedAt">[], decisions: Map<number, StoredDecision>) {
    const approved = new Set<string>(), rejected = new Set<string>();
    for (const g of gens) {
      const d = decisions.get(g.gen)?.decision;
      if (d === "approved") g.ruleIds.forEach((id) => approved.add(id));
      else if (d === "rejected") g.ruleIds.forEach((id) => rejected.add(id));
    }
    for (const rule of run.best.rules) {
      // A rule is on if any approved generation carries it; off if only rejected ones do.
      const want = approved.has(rule.id) ? "approved" : rejected.has(rule.id) ? "rejected" : null;
      if (!want || rule.status === want) continue;
      await darwin(`/rules/${encodeURIComponent(rule.id)}/${want === "approved" ? "approve" : "reject"}`, { method: "POST" });
      rule.status = want;
    }
    this.syncedRun = run.run_id;
  }

  /** Everything the Darwin page needs; also re-applies decisions if Darwin restarted. */
  async view() {
    try {
      const run = await darwin<DarwinRun>("/runs/latest");
      const texts = new Map(run.best.rules.map((r) => [r.id, r.text]));
      const [gens, decisions] = await Promise.all([this.generations(run, texts), this.store.list()]);
      if (this.syncedRun !== run.run_id) await this.sync(run, gens, decisions);
      return {
        connected: true,
        store: this.store.kind,
        replayed: run.baseline.requests,
        generations: gens.map((g) => ({ ...g, status: (decisions.get(g.gen)?.decision ?? "proposed") as GenStatus, decidedAt: decisions.get(g.gen)?.at ?? null })),
      };
    } catch (err) {
      console.warn(`[evolution] ${(err as Error).message}`);
      return { connected: false, store: this.store.kind, replayed: 0, generations: [] as GenerationFruit[] };
    }
  }

  /** Approve or reject one generation's fruit, store it, and update Darwin. */
  async decide(gen: number, decision: Decision) {
    const run = await darwin<DarwinRun>("/runs/latest");
    const gens = await this.generations(run, new Map(run.best.rules.map((r) => [r.id, r.text])));
    const g = gens.find((x) => x.gen === gen);
    if (!g) throw Object.assign(new Error(`No generation ${gen} in Darwin's latest run`), { status: 404 });
    const stored: StoredDecision = { gen, decision, rule_ids: g.ruleIds, at: new Date().toISOString() };
    await this.store.record(stored, run.run_id);
    const decisions = await this.store.list();
    decisions.set(gen, stored); // the reader may lag the writer by a moment
    await this.sync(run, gens, decisions);
    return {
      gen,
      status: decision,
      rules: run.best.rules.filter((r) => g.ruleIds.includes(r.id)).map((r) => ({ id: r.id, status: r.status })),
      store: this.store.kind,
    };
  }
}
