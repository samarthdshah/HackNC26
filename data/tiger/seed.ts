// Seed Tiger Data: apply schema.sql, load the Photon fixtures, assert the demo rows, and check the demo stats.
// Re-runnable: schema.sql drops and recreates everything. One transaction, so a failed run leaves the old data.
// Run: npm --prefix data run tiger:seed

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
if (!process.env.TIGER_DATABASE_URL) {
  console.error("Missing env vars: TIGER_DATABASE_URL");
  process.exit(1);
}

type Row = Record<string, any>;

function fixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
}

const departments: Row[] = fixture("departments");
const people: Row[] = fixture("people");
const requests: Row[] = fixture("requests");
const edges: Row[] = fixture("edges");
const bookings: Row[] = fixture("bookings");

// Same rule as snowflake/load.ts.
const HR_TYPES = ["leave_request", "benefits_question", "employee_relations"];
// Hop outcome -> event type for the backfilled feed.
const HOP_EVENT: Record<string, string> = { forwarded: "forwarded", bounced: "bounced", delegated: "delegated", handled: "resolved" };

const actors = [
  ...departments.map((d) => ({ id: d.id, kind: "department", name: d.name, department_id: d.id })),
  ...people.map((p) => ({ id: p.id, kind: "person", name: p.name, department_id: p.department_id })),
  { id: "agent", kind: "agent", name: "Wayfinder agent", department_id: null },
];

const requestRows = requests.map((r) => ({
  id: r.id,
  task_type: r.task_type,
  title: r.title,
  requester_id: r.requester_id,
  created_at: r.created_at,
  status: r.status,
  resolved_at: r.resolved_at,
  resolved_by: r.resolved_by,
  resolution: r.resolution,
  severity: r.severity ?? null,
  new_hire_name: r.new_hire_name ?? null,
  new_hire_id: r.new_hire_id ?? null,
  room_id: r.room_id ?? null,
  vendor_id: r.vendor_id ?? null,
  amount_usd: r.amount_usd ?? null,
  hr_sensitive: HR_TYPES.includes(r.task_type),
}));

const hopRows = requests.flatMap((r) =>
  r.hops.map((h: Row) => ({
    request_id: r.id,
    seq: h.seq,
    from_id: h.from,
    to_id: h.to,
    at: h.at,
    outcome: h.outcome,
    redirect_to: h.redirect_to ?? null,
    note: h.note ?? null,
  })),
);

const edgeRows = edges.map((e) => ({
  from_id: e.from,
  to_id: e.to,
  task_type: e.task_type,
  confidence: e.confidence,
  source: e.source,
  delegate_until: e.delegate_until ?? null,
}));

const bookingRows = bookings.map((b) => ({
  id: b.id,
  room_id: b.room_id,
  booked_by: b.booked_by,
  title: b.title,
  start_at: b.start,
  end_at: b.end,
  attendees_expected: b.attendees_expected,
  status: b.status,
  used_until: b.used_until,
  note: b.note,
}));

// Backfilled feed: one request_created per request, then one event per hop when its receiver acted
// (the next hop, or resolution; the hop's own time if it is still the open last hop).
const eventRows = requests.flatMap((r) => [
  {
    id: `seed_${r.id}_0`,
    ts: r.created_at,
    type: "request_created",
    actor: r.requester_id,
    request_id: r.id,
    payload: { seeded: true, task_type: r.task_type, title: r.title, requester_id: r.requester_id, to: r.hops[0].to },
  },
  ...r.hops.map((h: Row, i: number) => ({
    id: `seed_${r.id}_${h.seq}`,
    ts: r.hops[i + 1]?.at ?? r.resolved_at ?? h.at,
    type: HOP_EVENT[h.outcome],
    actor: h.to,
    request_id: r.id,
    payload: { seeded: true, seq: h.seq, from: h.from, to: h.to, redirect_to: h.redirect_to, note: h.note },
  })),
]);

// Table -> [rows, column definitions for jsonb_to_recordset]. Insert order follows the foreign keys.
const LOADS: [string, Row[], string][] = [
  ["actors", actors, "id text, kind text, name text, department_id text"],
  [
    "requests",
    requestRows,
    "id text, task_type text, title text, requester_id text, created_at timestamptz, status text, resolved_at timestamptz, " +
      "resolved_by text, resolution text, severity text, new_hire_name text, new_hire_id text, room_id text, vendor_id text, " +
      "amount_usd numeric, hr_sensitive boolean",
  ],
  ["request_hops", hopRows, "request_id text, seq int, from_id text, to_id text, at timestamptz, outcome text, redirect_to text, note text"],
  ["org_edges", edgeRows, "from_id text, to_id text, task_type text, confidence real, source text, delegate_until timestamptz"],
  [
    "bookings",
    bookingRows,
    "id text, room_id text, booked_by text, title text, start_at timestamptz, end_at timestamptz, attendees_expected int, " +
      "status text, used_until timestamptz, note text",
  ],
  ["events", eventRows, "id text, ts timestamptz, type text, actor text, request_id text, payload jsonb"],
];

const failures: string[] = [];
function expect(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
}

const client = new pg.Client({ connectionString: process.env.TIGER_DATABASE_URL });
client.on("notice", (n) => console.log(`notice: ${n.message}`));
await client.connect();
const one = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0];

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL client_min_messages = warning");
  await client.query(readFileSync(new URL("schema.sql", import.meta.url), "utf8"));
  await client.query("SET LOCAL client_min_messages = notice");
  const overlap = await one("SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'bookings_no_overlap'");
  if (!overlap.n) console.log("notice: btree_gist unavailable, bookings_no_overlap skipped");

  for (const [table, rows, cols] of LOADS) {
    const names = cols.split(", ").map((c) => c.split(" ")[0]).join(", ");
    await client.query(`INSERT INTO ${table} (${names}) SELECT ${names} FROM jsonb_to_recordset($1::jsonb) AS x(${cols})`, [
      JSON.stringify(rows),
    ]);
  }

  console.log("Row counts (tiger vs fixtures):");
  for (const [table, rows] of LOADS) expect(table, (await one(`SELECT count(*)::int AS n FROM ${table}`)).n, rows.length);

  console.log("Demo rows:");
  const leo = await one(
    `SELECT r.status, r.task_type, r.requester_id, count(h.*)::int AS hops,
            string_agg(h.to_id || ' ' || h.outcome || ' -> ' || h.redirect_to, '; ') AS hop
     FROM requests r JOIN request_hops h ON h.request_id = r.id WHERE r.id = 'req_demo_leo'
     GROUP BY r.status, r.task_type, r.requester_id`,
  );
  expect("req_demo_leo", leo && `${leo.status} ${leo.task_type} ${leo.requester_id} ${leo.hops} hop: ${leo.hop}`,
    "open data_access p_leo 1 hop: dept_data_platform bounced -> dept_analytics_eng");
  const priya = await one(
    `SELECT string_agg(task_type, ',' ORDER BY task_type) AS types FROM org_edges
     WHERE from_id = 'p_priya' AND to_id = 'p_tom' AND delegate_until = '2026-10-16T17:00:00-04:00'
       AND delegate_until > '2026-10-10T00:00:00-04:00'`,
  );
  expect("p_priya -> p_tom delegate edges until 2026-10-16 17:00", priya.types, "data_access,purchase_approval");
  const sam = await one(
    `SELECT room_id, status, to_char(start_at AT TIME ZONE 'America/New_York', 'HH24:MI') AS s,
            to_char(end_at AT TIME ZONE 'America/New_York', 'HH24:MI') AS e,
            to_char(used_until AT TIME ZONE 'America/New_York', 'HH24:MI') AS u
     FROM bookings WHERE id = 'bk_sam_commons'`,
  );
  expect("bk_sam_commons", sam && `${sam.room_id} ${sam.s}-${sam.e} ${sam.status} until ${sam.u}`,
    "rm_commons 11:00-13:00 partially_used until 12:00");
  const checkout = await one(
    `SELECT count(*)::int AS n,
            string_agg(r.id, ',' ORDER BY r.id) FILTER (WHERE a.department_id = 'dept_platform') AS direct,
            string_agg(r.id, ',' ORDER BY r.id) FILTER (WHERE a.department_id <> 'dept_platform') AS routed
     FROM requests r
     JOIN request_hops h ON h.request_id = r.id AND h.seq = 1
     JOIN actors a ON a.id = h.to_id
     WHERE r.task_type = 'checkout_incident' AND r.status = 'resolved'`,
  );
  expect("checkout incidents", `${checkout.n} direct ${checkout.direct} routed ${checkout.routed}`,
    "6 direct req_0017,req_0066 routed req_0004,req_0029,req_0043,req_0055");

  // learn_edge smoke test on Leo's bounce, rolled back so the seed keeps the chart edges.
  console.log("learn_edge (rolled back):");
  await client.query("SAVEPOINT learn");
  const learned = (
    await client.query(
      `SELECT to_id, confidence, source FROM learn_edge('agent', 'dept_data_platform', 'dept_analytics_eng', 'data_access', 'req_demo_leo')`,
    )
  ).rows.map((e) => `${e.to_id} ${e.confidence} ${e.source}`);
  expect("edges", learned.join("; "), "dept_data_platform 0.4 chart; dept_analytics_eng 0.8 learned");
  expect("edge_updated events", (await one("SELECT count(*)::int AS n FROM events WHERE type = 'edge_updated'")).n, 2);
  await client.query("ROLLBACK TO SAVEPOINT learn");

  // PLAN.md 3.1 and 3.2.
  console.log("Insights:");
  const hire = await one(
    `WITH last10 AS (
       SELECT r.id, r.created_at, r.resolved_at,
              (SELECT count(*) FROM request_hops h WHERE h.request_id = r.id) AS hops
       FROM requests r
       WHERE r.task_type = 'onboarding' AND r.status = 'resolved'
       ORDER BY r.created_at DESC
       LIMIT 10
     )
     SELECT count(*)::int AS requests,
            round(avg(extract(epoch FROM resolved_at - created_at)::numeric) / 86400, 2) AS avg_days,
            round(avg(hops)::numeric, 2) AS avg_hops
     FROM last10`,
  );
  expect("new hires (last 10): requests", hire.requests, 10);
  expect("new hires (last 10): avg days", hire.avg_days, "4.01");
  expect("new hires (last 10): avg hops", hire.avg_hops, "6.00");
  const paths = (
    await client.query(
      `SELECT CASE WHEN a.department_id = 'dept_platform' THEN 'direct' ELSE 'routed' END AS path,
              count(*)::int AS incidents,
              round(avg(extract(epoch FROM r.resolved_at - r.created_at)::numeric) / 60) AS avg_minutes,
              round(avg((SELECT count(*) FROM request_hops x WHERE x.request_id = r.id))::numeric, 1) AS avg_hops
       FROM requests r
       JOIN request_hops h ON h.request_id = r.id AND h.seq = 1
       JOIN actors a ON a.id = h.to_id
       WHERE r.task_type = 'checkout_incident' AND r.status = 'resolved'
       GROUP BY 1
       ORDER BY 1`,
    )
  ).rows;
  const path = (p: string) => paths.find((r) => r.path === p) ?? {};
  expect("checkout direct", `${path("direct").incidents} incidents, ${path("direct").avg_minutes} min, ${path("direct").avg_hops} hops`, "2 incidents, 43 min, 2.0 hops");
  expect("checkout routed", `${path("routed").incidents} incidents, ${path("routed").avg_minutes} min, ${path("routed").avg_hops} hops`, "4 incidents, 233 min, 3.8 hops");

  if (failures.length) throw new Error(`${failures.length} check(s) failed: ${failures.join(", ")}`);
  await client.query("COMMIT");
  console.log("PASS: committed");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`FAIL: rolled back. ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
