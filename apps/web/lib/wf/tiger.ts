// Tiger source: read-only, as wayfinder_web, from the *_public views (HR text masked).
// Like services/darwin/db.py, only host and database come from TIGER_DATABASE_URL; the
// login is forced to wayfinder_web with TIGER_WEB_PASSWORD and a read-only session. Server-only.

import pg from "pg";
import type { Actor, Booking, Event, Hop, OrgEdge, OrgEdgeChange, Request } from "@wayfinder/shared";
import { loadDirectory } from "./fixtures";
import type { RawData } from "./source";

const LOGIN = "wayfinder_web";
let pool: pg.Pool | undefined;

export const tigerConfigured = () => Boolean(process.env.TIGER_DATABASE_URL && process.env.TIGER_WEB_PASSWORD) && process.env.WF_SOURCE !== "fixtures";

function getPool() {
  if (pool) return pool;
  const u = new URL(process.env.TIGER_DATABASE_URL!);
  pool = new pg.Pool({
    host: u.hostname,
    port: Number(u.port || 5432),
    database: u.pathname.replace(/^\//, "") || "tsdb",
    user: LOGIN,
    password: process.env.TIGER_WEB_PASSWORD,
    ssl: { rejectUnauthorized: process.env.TIGER_TLS_INSECURE !== "1" },
    options: "-c default_transaction_read_only=on",
    application_name: "wayfinder-web",
    max: 4,
    connectionTimeoutMillis: 8000,
  });
  pool.on("error", (err) => console.warn(`[tiger] ${err.message}`));
  return pool;
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadTiger(): Promise<RawData> {
  const db = getPool();
  const q = (sql: string) => db.query(sql).then((r) => r.rows);
  const [actors, reqs, hops, events, edges, changes, bookings] = await Promise.all([
    q(`select id, kind, name, department_id from actors`),
    q(`select * from requests_public order by created_at`),
    q(`select request_id, seq, from_id, to_id, at, outcome, redirect_to, note from request_hops_public order by request_id, seq`),
    q(`select id, ts, type, actor, request_id, tool, payload from events_public
        where request_id is null or payload->>'seeded' is distinct from 'true' order by ts`),
    q(`select * from org_edges where delegate_until is null or delegate_until > now()`),
    q(`select * from org_edge_changes order by changed_at`),
    q(`select * from bookings order by start_at`),
  ]);
  return {
    source: "tiger",
    ...loadDirectory(),
    actors: actors as Actor[],
    requests: reqs.map((r): Request => ({
      ...r, created_at: iso(r.created_at)!, resolved_at: iso(r.resolved_at), amount_usd: num(r.amount_usd),
    })),
    hops: hops.map((h): Hop => ({
      request_id: h.request_id, seq: h.seq, from: h.from_id, to: h.to_id, at: iso(h.at)!, outcome: h.outcome, redirect_to: h.redirect_to, note: h.note,
    })),
    events: events.map((e): Event => ({ ...e, ts: iso(e.ts)!, request_id: e.request_id ?? undefined, tool: e.tool ?? undefined })),
    edges: edges.map((e): OrgEdge => ({
      from: e.from_id, to: e.to_id, task_type: e.task_type, confidence: Number(e.confidence), source: e.source,
      ...(e.delegate_until ? { delegate_until: iso(e.delegate_until)! } : {}),
    })),
    edgeChanges: changes.map((c): OrgEdgeChange => ({
      from: c.from_id, to: c.to_id, task_type: c.task_type, confidence: Number(c.confidence), source: c.source,
      delegate_until: iso(c.delegate_until) ?? undefined, changed_at: iso(c.changed_at)!, previous_confidence: num(c.previous_confidence),
      reason: c.reason, request_id: c.request_id,
    })),
    bookings: bookings.map((b): Booking => ({
      id: b.id, room_id: b.room_id, booked_by: b.booked_by, title: b.title, start: iso(b.start_at)!, end: iso(b.end_at)!,
      attendees_expected: b.attendees_expected, status: b.status, used_until: iso(b.used_until), note: b.note, released_at: iso(b.released_at),
    })),
  };
}

/** Tiger when configured and reachable, else the fixtures. */
export async function loadRaw(): Promise<RawData> {
  if (tigerConfigured()) {
    try { return await loadTiger(); } catch (err) {
      console.warn(`[wf] Tiger unavailable, using fixtures: ${err instanceof Error ? err.message : err}`);
    }
  }
  const { loadFixtures } = await import("./fixtures");
  return loadFixtures();
}
