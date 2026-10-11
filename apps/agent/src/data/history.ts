// Request history for the website, as plain rows. With Tiger configured it reads
// Lane C's public views as wayfinder_web (the database owns HR masking and Insights).
// Without Tiger (e.g. offline testing) it computes the same shapes from the seed in
// data/fixtures, masking HR text the way requests_public does.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { env } from "../env.ts";
import { departments, people } from "./fixtures.ts";

type Row = Record<string, any>;

export interface History {
  source: "tiger" | "fixtures";
  requests: Row[]; // id, title, task_type, requester_id, status, created_at, resolved_at (newest first)
  hops: Row[]; // request_id, seq, to_id, outcome, note, at
  saved: Row[]; // kind, hours (insights_hours_saved)
  summary: Row; // requests, people, median (hours)
  weekly: Row[]; // week, requests, resolved, hops
  deptStats: Row[]; // department_id, department, hops_received, total_hours
  routes: Row[]; // a, b, volume (department to department)
  events: Row[]; // type, n
}

export interface HistorySource {
  source: "tiger" | "fixtures";
  load(): Promise<History>;
  check(): Promise<void>;
  close(): Promise<void>;
}

// ── Tiger ──────────────────────────────────────────────────────────────────

function tigerSource(password: string): HistorySource {
  const u = new URL(env.tiger.url);
  u.searchParams.delete("sslmode");
  u.username = "wayfinder_web";
  u.password = encodeURIComponent(password);
  const db = new pg.Pool({ connectionString: u.toString(), ssl: { rejectUnauthorized: !env.tiger.insecureTls }, max: 4, connectionTimeoutMillis: 8000, statement_timeout: 10000 });
  db.on("error", () => console.warn("[web] database connection interrupted"));
  const rows = async (sql: string) => (await db.query(sql)).rows;
  return {
    source: "tiger",
    async check() {
      await db.query("select 1 from requests_public limit 1");
    },
    async load() {
      const [requests, hops, saved, summary, weekly, deptStats, routes, events] = await Promise.all([
        rows("select id, title, task_type, requester_id, status, created_at, resolved_at from requests_public order by created_at desc limit 200"),
        rows("select request_id, seq, to_id, outcome, note, at from request_hops_public order by request_id, seq"),
        rows("select kind, hours from insights_hours_saved"),
        rows(`select count(*)::int as requests, count(distinct requester_id)::int as people,
          coalesce(percentile_cont(0.5) within group (order by extract(epoch from (resolved_at-created_at))/3600) filter (where status='resolved'),0) as median
          from requests_public`),
        rows(`select date_trunc('week',r.created_at) as week, count(*)::int as requests,
          count(*) filter (where r.status='resolved')::int as resolved,
          coalesce(avg(h.n),0) as hops from requests_public r left join
          (select request_id,count(*) as n from request_hops_public group by request_id) h on h.request_id=r.id
          group by 1 order by 1`),
        rows("select department_id, department, hops_received, total_hours from insights_bottlenecks order by rank"),
        rows(`select a.department_id as a,b.department_id as b,count(*)::int as volume
          from request_hops_public h join actors a on a.id=h.from_id join actors b on b.id=h.to_id
          where a.department_id is not null and b.department_id is not null group by 1,2`),
        rows("select type,count(*)::int as n from events_public where type in ('approved','introduction_sent') group by type"),
      ]);
      return { source: "tiger", requests, hops, saved, summary: summary[0], weekly, deptStats, routes, events };
    },
    async close() {
      await db.end();
    },
  };
}

// ── fixtures ───────────────────────────────────────────────────────────────

const HR = new Set(["leave_request", "benefits_question", "employee_relations"]);
const MASK = "[visible to HR only]";

function fixtureSource(): HistorySource {
  const file = fileURLToPath(new URL("../../../../data/fixtures/requests.json", import.meta.url));
  return {
    source: "fixtures",
    async check() {},
    async close() {},
    async load() {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Row[];
      const deptOf = (id: string) => (id.startsWith("dept_") ? id : people.find((p) => p.id === id)?.department_id);
      const hours = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

      const requests = raw
        .map((r) => ({ id: r.id, title: HR.has(r.task_type) ? MASK : r.title, task_type: r.task_type, requester_id: r.requester_id, status: r.status, created_at: r.created_at, resolved_at: r.resolved_at }))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const hops = raw.flatMap((r) =>
        (r.hops as Row[]).map((h) => ({ request_id: r.id, seq: h.seq, to_id: h.to, from_id: h.from, outcome: h.outcome, note: HR.has(r.task_type) ? MASK : (h.note ?? null), at: h.at })),
      );

      const resolved = raw.filter((r) => r.status === "resolved" && r.resolved_at).map((r) => hours(r.created_at, r.resolved_at)).sort((a, b) => a - b);
      const median = resolved.length ? (resolved[(resolved.length - 1) >> 1] + resolved[resolved.length >> 1]) / 2 : 0;

      const weekStart = (iso: string) => {
        const d = new Date(iso);
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday, like date_trunc('week')
        return d.toISOString();
      };
      const weeks = new Map<string, { requests: number; resolved: number; hops: number }>();
      for (const r of raw) {
        const w = weeks.get(weekStart(r.created_at)) ?? { requests: 0, resolved: 0, hops: 0 };
        w.requests++;
        if (r.status === "resolved") w.resolved++;
        w.hops += r.hops.length;
        weeks.set(weekStart(r.created_at), w);
      }

      // Hours each department held requests: from receiving a hop until the next one (or resolution).
      const held = new Map<string, { hops_received: number; total_hours: number }>();
      for (const r of raw.filter((x) => x.status === "resolved")) {
        r.hops.forEach((h: Row, i: number) => {
          const dept = deptOf(h.to);
          if (!dept) return;
          const until = r.hops[i + 1]?.at ?? r.resolved_at;
          const s = held.get(dept) ?? { hops_received: 0, total_hours: 0 };
          s.hops_received++;
          s.total_hours += Math.max(0, hours(h.at, until));
          held.set(dept, s);
        });
      }
      const flows = new Map<string, number>();
      for (const h of hops) {
        const a = deptOf(h.from_id), b = deptOf(h.to_id);
        if (a && b) flows.set(`${a}|${b}`, (flows.get(`${a}|${b}`) ?? 0) + 1);
      }

      return {
        source: "fixtures",
        requests,
        hops,
        saved: [],
        summary: { requests: raw.length, people: new Set(raw.map((r) => r.requester_id)).size, median },
        weekly: [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, w]) => ({ week, requests: w.requests, resolved: w.resolved, hops: w.hops / w.requests })),
        deptStats: [...held]
          .sort(([, a], [, b]) => b.total_hours - a.total_hours)
          .map(([id, s]) => ({ department_id: id, department: departments.find((d) => d.id === id)?.name ?? id, hops_received: s.hops_received, total_hours: Math.round(s.total_hours * 10) / 10 })),
        routes: [...flows].map(([k, volume]) => {
          const [a, b] = k.split("|");
          return { a, b, volume };
        }),
        events: [],
      };
    },
  };
}

export function createHistory(): HistorySource {
  const web = process.env.TIGER_WEB_PASSWORD?.trim();
  if (env.tiger.url && web) return tigerSource(web);
  if (env.tiger.url) console.warn("[web] TIGER_WEB_PASSWORD not set; showing history from data/fixtures");
  return fixtureSource();
}
