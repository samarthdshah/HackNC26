// Tiger Data (Postgres + TimescaleDB). Lane C owns the schema; data/tiger/SCHEMA.md
// is the contract. The agent's login (wayfinder_agent) may only:
//   insert events          C's events_derive trigger turns request_created / hop /
//                          request_resolved|denied|stuck into requests + request_hops,
//                          which is what Insights and Darwin read
//   upsert org_edges       plus one org_edge_changes row per change, in one transaction
//   select/update bookings
// It cannot read events or requests, or delete anything.
//
// Writes go through one ordered queue and never block a conversation.
// TIGER_DISABLED=1 (sims, tests) keeps everything local.

import pg from "pg";
import type { Event, OrgEdge } from "@wayfinder/shared";
import { env } from "../env.ts";

export interface EdgeChange {
  previous: number | null;
  reason: "redirected" | "delegated" | "reinforced" | "reset";
  requestId?: string;
}

let pool: pg.Pool | undefined;
let ready: Promise<boolean> | undefined;
let queue: Promise<unknown> = Promise.resolve();

export const tigerConfigured = () =>
  Boolean(env.tiger.url && env.tiger.password) && process.env.TIGER_DISABLED !== "1";

function getPool(): pg.Pool {
  if (pool) return pool;
  const url = new URL(env.tiger.url);
  url.searchParams.delete("sslmode"); // TLS is configured below
  // pg lets the connection string override a separate `password` option, so it goes in the URL.
  if (env.tiger.password) url.password = encodeURIComponent(env.tiger.password);
  pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: !env.tiger.insecureTls },
    max: 4,
    connectionTimeoutMillis: 8000,
  });
  pool.on("error", (err) => console.warn(`[tiger] ${err.message}`));
  // The events trigger never fails our insert; it skips the derived write and sends a WARNING.
  pool.on("connect", (client) => client.on("notice", (n) => console.warn(`[tiger] ${n.severity}: ${n.message}`)));
  return pool;
}

/** True once we know Tiger is reachable and Lane C's tables exist. */
export function tigerReady(): Promise<boolean> {
  ready ??= (async () => {
    if (!tigerConfigured()) return false;
    try {
      const { rows } = await getPool().query(
        `select bool_and(to_regclass(t) is not null) as ok from unnest(array['events','org_edges','org_edge_changes']) t`,
      );
      if (!rows[0].ok) {
        console.warn("[tiger] connected, but Lane C's tables are missing. Logging locally.");
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[tiger] unavailable, logging locally: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  })();
  return ready;
}

/** Run writes in order, after Tiger is known to be ready; failures are logged, never thrown. */
function enqueue(write: (db: pg.Pool) => Promise<unknown>) {
  queue = queue.then(async () => {
    if (!(await tigerReady())) return;
    try {
      await write(getPool());
    } catch (err) {
      console.warn(`[tiger] write failed: ${err instanceof Error ? err.message : err}`);
    }
  });
}

/** Resolves once every queued write has been attempted (scripts and tests). */
export const tigerFlushed = () => queue;

// ── events ─────────────────────────────────────────────────────────────────

export function writeEvent(e: Event) {
  enqueue((db) =>
    db.query(
      `insert into events (id, ts, type, actor, request_id, tool, payload) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
      [e.id, e.ts, e.type, e.actor, e.request_id ?? null, e.tool ?? null, JSON.stringify(e.payload)],
    ),
  );
}

// ── org map ────────────────────────────────────────────────────────────────

/** Edge and its history row in one transaction (SCHEMA.md "Writing edges"). */
export function writeEdge(e: OrgEdge, change: EdgeChange) {
  enqueue(async (db) => {
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into org_edges (from_id, to_id, task_type, confidence, source, delegate_until, learned_from)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (from_id, to_id, task_type) do update set
           confidence = excluded.confidence, source = excluded.source, delegate_until = excluded.delegate_until,
           learned_from = coalesce(excluded.learned_from, org_edges.learned_from), updated_at = now()`,
        [e.from, e.to, e.task_type, e.confidence, e.source, e.delegate_until ?? null, e.source === "learned" ? (change.requestId ?? null) : null],
      );
      await client.query(
        `insert into org_edge_changes (from_id, to_id, task_type, previous_confidence, confidence, source, delegate_until, reason, request_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [e.from, e.to, e.task_type, change.previous, e.confidence, e.source, e.delegate_until ?? null, change.reason, change.requestId ?? null],
      );
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
}

/** The org map as stored in Tiger, or undefined when Tiger isn't ready or is empty. */
export async function readEdges(): Promise<OrgEdge[] | undefined> {
  if (!(await tigerReady())) return undefined;
  const { rows } = await getPool().query(
    `select from_id, to_id, task_type, confidence, source, delegate_until from org_edges`,
  );
  if (rows.length === 0) return undefined;
  return rows.map((r) => ({
    from: r.from_id,
    to: r.to_id,
    task_type: r.task_type,
    confidence: Number(r.confidence),
    source: r.source,
    ...(r.delegate_until && { delegate_until: new Date(r.delegate_until).toISOString() }),
  }));
}

/** Direct query for reads and writes that must complete now (bookings). Undefined when Tiger isn't ready. */
export async function tigerQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, args: unknown[] = []) {
  if (!(await tigerReady())) return undefined;
  return getPool().query<T>(sql, args);
}

export async function closeTiger() {
  await queue;
  await pool?.end();
}
