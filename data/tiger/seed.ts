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
// Leo's request is created live by lane A (req_live_*), so it is not seeded: no request, hops, or events.
const LIVE_ONLY = ["req_demo_leo"];
const requests: Row[] = fixture("requests").filter((r: Row) => !LIVE_ONLY.includes(r.id));
const edges: Row[] = fixture("edges");
const bookings: Row[] = fixture("bookings");

// Same rule as snowflake/load.ts and the generated requests.hr_sensitive column; used to check the HR-masked views.
const HR_TYPES = ["leave_request", "benefits_question", "employee_relations"];

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

// Backfilled feed: one request_created per request, then one "hop" event (A's shape) per hop when its receiver acted
// (the next hop, or resolution; the hop's own time if it is still the open last hop). The events trigger ignores
// them because the requests and hops are loaded first.
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
    type: "hop",
    actor: h.to,
    request_id: r.id,
    payload: { seeded: true, request_id: r.id, seq: h.seq, from: h.from, to: h.to, outcome: h.outcome, redirect_to: h.redirect_to, note: h.note },
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
const rows = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0];

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL client_min_messages = warning");
  await client.query(readFileSync(new URL("schema.sql", import.meta.url), "utf8"));
  // Recreated tables lose their grants, so re-apply the login grants (roles are created NOLOGIN if missing).
  await client.query(readFileSync(new URL("roles.sql", import.meta.url), "utf8"));
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

  // Events trigger: present, runs as the owner, and derived nothing from the seed events (all ids already loaded).
  console.log("Events trigger:");
  const trig = await one(
    `SELECT p.prosecdef AS definer, pg_get_userbyid(p.proowner) = current_user AS owner_fn,
            (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid = 'events'::regclass AND t.tgname = 'events_derive') AS triggers
     FROM pg_proc p WHERE p.proname = 'events_derive'`,
  );
  expect("events_derive: security definer, owned by owner, triggers on events", trig && `${trig.definer} ${trig.owner_fn} ${trig.triggers}`, "true true 1");
  expect("requests derived from seed events (origin agent)", (await one("SELECT count(*)::int AS n FROM requests WHERE origin = 'agent'")).n, 0);
  const types = await one("SELECT string_agg(type || ' ' || n, ', ' ORDER BY type) AS t FROM (SELECT type, count(*) AS n FROM events GROUP BY type) x");
  expect("event types", types.t, `hop ${hopRows.length}, request_created ${requestRows.length}`);
  expect(
    "hop events matching their request_hops row (seq, from, to, outcome, redirect_to)",
    (await one(
      `SELECT count(*)::int AS n FROM events e JOIN request_hops h
         ON h.request_id = e.payload->>'request_id' AND h.seq = (e.payload->>'seq')::int AND h.from_id = e.payload->>'from'
        AND h.to_id = e.payload->>'to' AND h.outcome = e.payload->>'outcome' AND h.redirect_to IS NOT DISTINCT FROM e.payload->>'redirect_to'
       WHERE e.type = 'hop'`,
    )).n,
    hopRows.length,
  );
  // request_hops.at means "when to received it" for seeded and live rows: the trigger's mapping from hop event ts
  // (when to acted) gives back every fixture hop time.
  expect(
    "hop events whose received time (hop_received_at) equals request_hops.at",
    (await one(
      `SELECT count(*)::int AS n FROM events e JOIN request_hops h
         ON h.request_id = e.payload->>'request_id' AND h.seq = (e.payload->>'seq')::int
       WHERE e.type = 'hop' AND hop_received_at(h.request_id, h.seq, e.ts) = h.at`,
    )).n,
    hopRows.length,
  );

  console.log("Demo rows:");
  const leo = await one(
    `SELECT (SELECT count(*) FROM requests WHERE id = ANY($1))::int
          + (SELECT count(*) FROM request_hops WHERE request_id = ANY($1))::int
          + (SELECT count(*) FROM events WHERE request_id = ANY($1) OR payload->>'request_id' = ANY($1))::int AS n`,
    [LIVE_ONLY],
  );
  expect("req_demo_leo rows (requests + hops + events), created live by A", leo.n, 0);
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

  // Edges: chart only, Priya's delegations the only dated edges, and Data Platform the agent's top data_access route.
  console.log("org_edges:");
  expect("non-chart edges", (await one("SELECT count(*)::int AS n FROM org_edges WHERE source <> 'chart'")).n, 0);
  const dated = await one(
    "SELECT string_agg(from_id || '->' || to_id || ' ' || task_type, '; ' ORDER BY task_type) AS e FROM org_edges WHERE delegate_until IS NOT NULL",
  );
  expect("delegate edges", dated.e, "p_priya->p_tom data_access; p_priya->p_tom purchase_approval");
  const route = await rows(
    `SELECT to_id, confidence, source FROM org_edges_current
     WHERE from_id = 'agent' AND task_type = 'data_access' ORDER BY confidence DESC, to_id`,
  );
  expect("agent data_access routes", route.map((e) => `${e.to_id} ${e.confidence} ${e.source}`).join("; "), "dept_data_platform 0.7 chart");
  expect(
    "learned agent -> dept_analytics_eng data_access",
    (await one("SELECT count(*)::int AS n FROM org_edges WHERE from_id = 'agent' AND to_id = 'dept_analytics_eng' AND task_type = 'data_access'")).n,
    0,
  );
  expect("learn_edge function", (await one("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'learn_edge'")).n, 0);

  // org_edge_changes: empty at seed; A's write (upsert edge + history row, reason and request_id null) works. Rolled back.
  console.log("org_edge_changes (write rolled back):");
  const cols = await one(
    `SELECT string_agg(column_name || ' ' || is_nullable, ', ' ORDER BY ordinal_position) AS c
     FROM information_schema.columns WHERE table_name = 'org_edge_changes'`,
  );
  expect(
    "columns",
    cols.c,
    "id NO, changed_at NO, from_id NO, to_id NO, task_type NO, previous_confidence YES, confidence NO, source NO, delegate_until YES, reason YES, request_id YES",
  );
  expect("rows at seed", (await one("SELECT count(*)::int AS n FROM org_edge_changes")).n, 0);
  await client.query("SAVEPOINT a_write");
  await client.query(
    `INSERT INTO org_edges (from_id, to_id, task_type, confidence, source) VALUES ('agent', 'dept_data_platform', 'data_access', 0.4, 'chart')
     ON CONFLICT (from_id, to_id, task_type) DO UPDATE SET confidence = EXCLUDED.confidence, updated_at = now()`,
  );
  await client.query(
    `INSERT INTO org_edge_changes (from_id, to_id, task_type, previous_confidence, confidence, source)
     VALUES ('agent', 'dept_data_platform', 'data_access', 0.7, 0.4, 'chart')`,
  );
  const change = await one(
    `SELECT c.previous_confidence, c.confidence, e.confidence AS edge FROM org_edge_changes c
     JOIN org_edges e USING (from_id, to_id, task_type)`,
  );
  expect("upsert + history row", `${change.previous_confidence} -> ${change.confidence}, edge ${change.edge}`, "0.7 -> 0.4, edge 0.4");
  await client.query("ROLLBACK TO SAVEPOINT a_write");

  // Grants from roles.sql survive the reseed (full allow/deny checks: npm run tiger:test-roles).
  console.log("Login grants:");
  const grants = await one(
    `SELECT has_table_privilege('wayfinder_agent', 'events', 'INSERT') AS agent_insert_events,
            has_table_privilege('wayfinder_agent', 'org_edge_changes', 'INSERT') AS agent_insert_changes,
            has_table_privilege('wayfinder_web', 'requests_public', 'SELECT') AS web_requests_public,
            has_table_privilege('wayfinder_web', 'events', 'SELECT') AS web_events`,
  );
  expect("agent INSERT events, agent INSERT org_edge_changes, web SELECT requests_public, web SELECT events",
    `${grants.agent_insert_events} ${grants.agent_insert_changes} ${grants.web_requests_public} ${grants.web_events}`, "true true true false");

  // Insights views must return the PLAN.md values.
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
  const evLeaks = await one(
    `SELECT count(*)::int AS n
     FROM events_public e, jsonb_each_text(e.payload) AS kv, unnest($1::text[]) AS s
     WHERE strpos(kv.value, s) > 0`,
    [hrText],
  );
  expect(`HR-only strings found in events_public payloads (${hrText.length} checked)`, evLeaks.n, 0);
  const hrEvents = await one(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE coalesce(p.payload->>'title', p.payload->>'note') = $1)::int AS masked
     FROM events_public p JOIN requests r ON r.id = p.request_id
     WHERE r.hr_sensitive`,
    [mask],
  );
  expect("events_public HR events masked", `${hrEvents.masked} of ${hrEvents.n}`, `${hrIds.length + hrHops} of ${hrIds.length + hrHops}`);
  // HR events keep only structural keys; every other key (title, note, seeded, ...) is the placeholder.
  const keys = await one(
    `SELECT string_agg(DISTINCT k, ',' ORDER BY k) FILTER (WHERE v = e.payload->k) AS kept,
            string_agg(DISTINCT k, ',' ORDER BY k) FILTER (WHERE v = to_jsonb($1::text)) AS masked,
            count(*) FILTER (WHERE v <> e.payload->k AND v <> to_jsonb($1::text))::int AS other
     FROM events_public p JOIN events e ON e.id = p.id AND e.ts = p.ts JOIN requests r ON r.id = p.request_id,
          jsonb_each(p.payload) AS kv(k, v)
     WHERE r.hr_sensitive`,
    [mask],
  );
  expect("events_public HR keys kept / masked", `kept ${keys.kept}; masked ${keys.masked}; other ${keys.other}`,
    "kept from,outcome,redirect_to,request_id,requester_id,seq,task_type,to; masked note,seeded,title; other 0");
  const passthrough = await one(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE (e.id, e.ts, e.type, e.actor, e.request_id, e.tool, e.payload)
                             IS DISTINCT FROM (p.id, p.ts, p.type, p.actor, p.request_id, p.tool, p.payload))::int AS changed
     FROM events e
     JOIN events_public p ON p.id = e.id AND p.ts = e.ts
     LEFT JOIN requests r ON r.id = e.request_id
     WHERE NOT coalesce(r.hr_sensitive, false)`,
  );
  const nonHrEvents = eventRows.filter((e) => !hrIds.includes(e.request_id)).length;
  expect("events_public non-HR events identical to events", `${passthrough.changed} changed of ${passthrough.n}`, `0 changed of ${nonHrEvents}`);
  expect("events_public rows", (await one("SELECT count(*)::int AS n FROM events_public")).n, eventRows.length);
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
