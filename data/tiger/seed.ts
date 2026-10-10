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

// Same rule as snowflake/load.ts and the generated requests.hr_sensitive column; used to check the HR-masked views.
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
      "amount_usd numeric",
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

  // Insights views must return the PLAN.md values.
  const rows = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
  console.log("insights_new_hires:");
  const hire = await one("SELECT * FROM insights_new_hires");
  expect("last 10 onboarding", `${hire.requests} requests, ${hire.avg_days} days, ${hire.avg_hops} hops`, "10 requests, 4.01 days, 6.00 hops");

  console.log("insights_checkout:");
  const paths = await rows("SELECT * FROM insights_checkout");
  const path = (p: string) => paths.find((r) => r.path === p) ?? {};
  for (const [p, want] of [["direct", "2 incidents, 43 min, 2.0 hops"], ["routed", "4 incidents, 233 min, 3.8 hops"]]) {
    expect(p, `${path(p).incidents} incidents, ${path(p).avg_minutes} min, ${path(p).avg_hops} hops`, want);
  }

  console.log("insights_bottlenecks:");
  const dp = await one("SELECT * FROM insights_bottlenecks WHERE department_id = 'dept_data_platform'");
  expect("Data Platform", `${dp.bounces} of ${dp.hops_received} hops bounced, ${dp.bounce_hours} h`, "22 of 22 hops bounced, 341.3 h");
  const top = await one("SELECT * FROM insights_bottlenecks WHERE rank = 1");
  expect("rank 1 by total hours", `${top.department} ${top.total_hours} h`, "Analytics Engineering 829.7 h");
  expect("departments", (await one("SELECT count(*)::int AS n FROM insights_bottlenecks")).n, 10);

  console.log("insights_slowest_handoffs:");
  for (const [scope, want] of [["new_hires", "IT -> Analytics Engineering, 4 handoffs, 19.0 h"], ["all", "Requester -> Finance & Procurement, 17 handoffs, 27.6 h"]]) {
    const h = await one("SELECT * FROM insights_slowest_handoffs WHERE scope = $1 AND rank = 1", [scope]);
    expect(`top (${scope})`, h && `${h.from_name} -> ${h.to_name}, ${h.handoffs} handoffs, ${h.avg_hours} h`, want);
  }

  console.log("insights_hours_saved:");
  const saved = await rows("SELECT * FROM insights_hours_saved");
  const metric = (m: string) => saved.find((r) => r.metric === m) ?? {};
  for (const [m, want] of [
    ["checkout_direct_paging", "saved 12.7 h over 4 routed checkout incidents"],
    ["bounces", "lost 537.6 h over 36 bounced hops"],
    ["agent_routing", "saved 0.0 h over 0 resolved agent requests"],
  ]) {
    expect(m, `${metric(m).kind} ${metric(m).hours} h over ${metric(m).basis_count} ${metric(m).basis}`, want);
  }

  // HR masking: the generated hr_sensitive matches load.ts, and no HR text reaches the public views.
  console.log("HR-masked views:");
  const hrIds = requests.filter((r) => HR_TYPES.includes(r.task_type)).map((r) => r.id);
  const hrHops = requests.filter((r) => HR_TYPES.includes(r.task_type)).reduce((n, r) => n + r.hops.length, 0);
  expect("hr_sensitive requests (load.ts rule)", (await one("SELECT string_agg(id, ',' ORDER BY id) AS ids FROM requests WHERE hr_sensitive")).ids, hrIds.sort().join(","));
  const mask = "[visible to HR only]";
  const req = await one(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE title = $1 AND resolution = $1)::int AS masked
     FROM requests_public WHERE hr_sensitive`,
    [mask],
  );
  expect("requests_public HR rows masked", `${req.masked} of ${req.n}`, `${hrIds.length} of ${hrIds.length}`);
  const hop = await one(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE note = $1)::int AS masked FROM request_hops_public WHERE hr_sensitive`,
    [mask],
  );
  expect("request_hops_public HR notes masked", `${hop.masked} of ${hop.n}`, `${hrHops} of ${hrHops}`);
  // HR fixture text that never appears on a non-HR request must not show anywhere in the public views.
  const nonHr = requests.filter((r) => !HR_TYPES.includes(r.task_type));
  const nonHrText = new Set(nonHr.flatMap((r) => [r.title, r.resolution, ...r.hops.map((h: Row) => h.note)]));
  const hrText = [
    ...new Set(
      requests
        .filter((r) => HR_TYPES.includes(r.task_type))
        .flatMap((r) => [r.title, r.resolution, ...r.hops.map((h: Row) => h.note)])
        .filter((t) => t && !nonHrText.has(t)),
    ),
  ];
  const leaks = await one(
    `SELECT (SELECT count(*) FROM requests_public WHERE title = ANY($1) OR resolution = ANY($1))::int
          + (SELECT count(*) FROM request_hops_public WHERE note = ANY($1))::int AS n`,
    [hrText],
  );
  expect(`HR-only strings found in public views (${hrText.length} checked)`, leaks.n, 0);
  const plain = await one(
    "SELECT count(*) FILTER (WHERE title = $1 OR resolution = $1)::int AS n FROM requests_public WHERE NOT hr_sensitive",
    [mask],
  );
  expect("non-HR requests masked", plain.n, 0);

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
