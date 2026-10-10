// Connect as each Tiger login and check what it can and cannot do. Every check runs inside one transaction per role
// that is rolled back, so nothing is written. Denied means Postgres error 42501 (permission denied); any other error fails.
// Then a live check: wayfinder_agent plays a request through events (committed, so the trigger's rows are real), the
// owner confirms the derived rows and the Insights change, wayfinder_web confirms HR masking, and the owner deletes the
// test rows.
// Run: npm --prefix data run tiger:test-roles (after tiger:roles)

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
const missing = ["TIGER_DATABASE_URL", "TIGER_AGENT_PASSWORD", "TIGER_WEB_PASSWORD"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

type Check = [label: string, sql: string, want: "allow" | "deny"];

const AGENT: Check[] = [
  ["INSERT events", "INSERT INTO events (type, actor, request_id, payload) VALUES ('role_test', 'agent', 'req_live_test', '{}')", "allow"],
  ["SELECT org_edges", "SELECT * FROM org_edges LIMIT 1", "allow"],
  [
    "upsert org_edges",
    `INSERT INTO org_edges (from_id, to_id, task_type, confidence, source) VALUES ('agent', 'dept_analytics_eng', 'data_access', 0.75, 'learned')
     ON CONFLICT (from_id, to_id, task_type) DO UPDATE SET confidence = EXCLUDED.confidence, updated_at = now()`,
    "allow",
  ],
  ["UPDATE org_edges", "UPDATE org_edges SET confidence = 0.4, updated_at = now() WHERE from_id = 'agent' AND to_id = 'dept_data_platform' AND task_type = 'data_access'", "allow"],
  [
    "INSERT org_edge_changes (id sequence)",
    "INSERT INTO org_edge_changes (from_id, to_id, task_type, previous_confidence, confidence, source) VALUES ('agent', 'dept_data_platform', 'data_access', 0.7, 0.4, 'chart')",
    "allow",
  ],
  ["SELECT bookings", "SELECT * FROM bookings LIMIT 1", "allow"],
  ["UPDATE bookings", "UPDATE bookings SET note = note WHERE id = 'bk_sam_commons'", "allow"],
  ["SELECT events", "SELECT * FROM events LIMIT 1", "deny"],
  ["DELETE events", "DELETE FROM events WHERE type = 'role_test'", "deny"],
  ["UPDATE events", "UPDATE events SET type = type WHERE type = 'role_test'", "deny"],
  ["TRUNCATE events", "TRUNCATE events", "deny"],
  ["INSERT events RETURNING (needs SELECT)", "INSERT INTO events (type, actor, payload) VALUES ('role_test', 'agent', '{}') RETURNING id", "deny"],
  ["SELECT requests", "SELECT * FROM requests LIMIT 1", "deny"],
  ["SELECT request_hops", "SELECT * FROM request_hops LIMIT 1", "deny"],
  ["SELECT requests_public", "SELECT * FROM requests_public LIMIT 1", "deny"],
  ["SELECT insights_new_hires", "SELECT * FROM insights_new_hires", "deny"],
  ["SELECT actors", "SELECT * FROM actors LIMIT 1", "deny"],
  ["SELECT org_edge_changes", "SELECT * FROM org_edge_changes LIMIT 1", "deny"],
  ["DELETE org_edges", "DELETE FROM org_edges WHERE from_id = 'agent' AND task_type = 'data_access'", "deny"],
  ["INSERT bookings", "INSERT INTO bookings (id, room_id, booked_by, title, start_at, end_at, status) VALUES ('bk_t', 'rm_t', 'agent', 't', now(), now() + interval '1 hour', 'confirmed')", "deny"],
  ["DELETE bookings", "DELETE FROM bookings WHERE id = 'bk_sam_commons'", "deny"],
  ["CREATE TABLE", "CREATE TABLE role_test (x int)", "deny"],
];

const WEB_READS = [
  "requests_public", "request_hops_public", "events_public",
  "insights_new_hires", "insights_checkout", "insights_bottlenecks", "insights_slowest_handoffs", "insights_hours_saved",
  "org_edges", "org_edge_changes", "actors", "bookings",
];
const WEB: Check[] = [
  ...WEB_READS.map((v): Check => [`SELECT ${v}`, `SELECT * FROM ${v} LIMIT 1`, "allow"]),
  ["SELECT events", "SELECT * FROM events LIMIT 1", "deny"],
  ["SELECT requests", "SELECT * FROM requests LIMIT 1", "deny"],
  ["SELECT request_hops", "SELECT * FROM request_hops LIMIT 1", "deny"],
  ["SELECT hop_steps", "SELECT * FROM hop_steps LIMIT 1", "deny"],
  ["SELECT org_edges_current", "SELECT * FROM org_edges_current LIMIT 1", "deny"],
  ["INSERT events", "INSERT INTO events (type, actor, payload) VALUES ('role_test', 'web', '{}')", "deny"],
  ["UPDATE org_edges", "UPDATE org_edges SET confidence = confidence WHERE from_id = 'agent'", "deny"],
  ["INSERT org_edge_changes", "INSERT INTO org_edge_changes (from_id, to_id, task_type, confidence, source) VALUES ('agent', 'dept_it', 'laptop_setup', 0.9, 'chart')", "deny"],
  ["UPDATE bookings", "UPDATE bookings SET note = note WHERE id = 'bk_sam_commons'", "deny"],
  ["CREATE TABLE", "CREATE TABLE role_test (x int)", "deny"],
];

const failures: string[] = [];
let total = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  total++;
  const ok = String(actual) === String(expected);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  if (!ok) failures.push(`live ${label}`);
}

function login(role: string, passwordEnv: string) {
  const url = new URL(process.env.TIGER_DATABASE_URL!);
  url.username = role;
  url.password = encodeURIComponent(process.env[passwordEnv]!);
  return new pg.Client({ connectionString: url.toString() });
}

async function run(role: string, passwordEnv: string, checks: Check[]) {
  const client = login(role, passwordEnv);
  console.log(`${role}:`);
  try {
    await client.connect();
  } catch (e) {
    console.log(`  FAIL connect: ${(e as Error).message}`);
    failures.push(`${role} connect`);
    return;
  }
  console.log("  ok   connect");
  await client.query("BEGIN");
  for (const [label, sql, want] of checks) {
    await client.query("SAVEPOINT c");
    let got = "allow";
    let detail = "";
    try {
      await client.query(sql);
    } catch (e) {
      const err = e as { code?: string; message: string };
      got = err.code === "42501" ? "deny" : "error";
      detail = got === "error" ? ` (${err.code} ${err.message})` : "";
    }
    await client.query("ROLLBACK TO SAVEPOINT c");
    const ok = got === want;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${want === "allow" ? "allowed" : "denied "} ${label}${ok ? "" : `: got ${got}${detail}`}`);
    if (!ok) failures.push(`${role} ${label}`);
  }
  await client.query("ROLLBACK");
  await client.end();
}

const LIVE_IDS = ["req_live_test", "req_live_stuck", "req_live_hr_test"];
const INSIGHTS = ["insights_new_hires", "insights_checkout", "insights_bottlenecks", "insights_slowest_handoffs", "insights_hours_saved"];
const HR_SECRET = "LIVETEST-HR-SECRET";

async function live() {
  const owner = new pg.Client({ connectionString: process.env.TIGER_DATABASE_URL });
  const agent = login("wayfinder_agent", "TIGER_AGENT_PASSWORD");
  const web = login("wayfinder_web", "TIGER_WEB_PASSWORD");
  const warnings: string[] = [];
  agent.on("notice", (n) => warnings.push(n.message ?? ""));
  console.log("live request (wayfinder_agent writes events, committed, then removed):");
  await Promise.all([owner.connect(), agent.connect(), web.connect()]);
  const one = async (c: pg.Client, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
  const cleanup = async () => {
    await owner.query("DELETE FROM events WHERE request_id = ANY($1)", [LIVE_IDS]);
    await owner.query("DELETE FROM request_hops WHERE request_id = ANY($1)", [LIVE_IDS]);
    await owner.query("DELETE FROM requests WHERE id = ANY($1)", [LIVE_IDS]);
  };
  const insights = async () =>
    Object.fromEntries(
      await Promise.all(INSIGHTS.map(async (v) => [v, JSON.stringify((await owner.query(`SELECT * FROM ${v}`)).rows)] as const)),
    );
  // A's insert: app-generated id, no RETURNING.
  const emit = (type: string, actor: string, request_id: string, ts: Date, payload: object) =>
    agent.query("INSERT INTO events (id, ts, type, actor, request_id, payload) VALUES ($1, $2, $3, $4, $5, $6)", [
      randomUUID(), ts, type, actor, request_id, JSON.stringify(payload),
    ]);
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000);

  await cleanup(); // leftovers from an interrupted run
  const before = await insights();
  try {
    // Stuck is not resolved: status stuck, no resolved_at, and no Insights view moves. Onboarding, newest, so it would
    // enter the last-10 new hires if it counted as resolved.
    const stuck = "req_live_stuck";
    await emit("request_created", "p_leo", stuck, at(2), { request_id: stuck, task_type: "onboarding", title: "Onboarding (stuck test)" });
    await emit("hop", "agent", stuck, at(1), { request_id: stuck, seq: 1, from: "p_leo", to: "dept_it", outcome: "forwarded", note: "Waiting on IT." });
    await emit("request_stuck", "agent", stuck, at(0.5), { request_id: stuck });
    const st = await one(owner, "SELECT status, resolved_at FROM requests WHERE id = $1", [stuck]);
    expect("request_stuck: status, resolved_at", st && `${st.status}, ${st.resolved_at}`, "stuck, null");
    const afterStuck = await insights();
    expect("Insights views changed by a stuck request", INSIGHTS.filter((v) => before[v] !== afterStuck[v]).join(", ") || "none", "none");

    // Leo's demo, played live: Data Platform says "not us", Analytics Engineering handles it. Each hop event is sent
    // when its receiver acts; request_hops.at must come back as when the receiver got it.
    const id = "req_live_test";
    const created = at(3), bounced = at(2.5), handled = at(1.5);
    await emit("request_created", "p_leo", id, created, { request_id: id, task_type: "data_access", title: "Warehouse access (live test)" });
    await emit("hop", "agent", id, bounced, {
      request_id: id, seq: 1, from: "p_leo", to: "dept_data_platform", outcome: "bounced", redirect_to: "dept_analytics_eng", note: "Not us, try Analytics Engineering.",
    });
    await emit("hop", "agent", id, handled, { request_id: id, seq: 2, from: "dept_data_platform", to: "dept_analytics_eng", outcome: "handled", note: "Access granted." });
    await emit("request_resolved", "agent", id, handled, { request_id: id });
    // A bad hop (unknown actor) must not fail A's insert: the event lands, the hop is skipped with a warning.
    let badInsert = "ok";
    await emit("hop", "agent", id, at(1), { request_id: id, seq: 9, from: "dept_analytics_eng", to: "nobody", outcome: "forwarded" }).catch(
      (e) => (badInsert = `error ${(e as { code?: string }).code}`),
    );

    const req = await one(owner, "SELECT requester_id, task_type, status, origin, resolved_at IS NOT NULL AS done FROM requests WHERE id = $1", [id]);
    expect("request row", req && `${req.requester_id} ${req.task_type} ${req.status} ${req.origin} resolved_at ${req.done}`,
      "p_leo data_access resolved agent resolved_at true");
    const hops = await one(
      owner,
      "SELECT string_agg(seq || ' ' || from_id || '->' || to_id || ' ' || outcome || coalesce(' ' || redirect_to, ''), '; ' ORDER BY seq) AS h FROM request_hops WHERE request_id = $1",
      [id],
    );
    expect("hops", hops.h, "1 p_leo->dept_data_platform bounced dept_analytics_eng; 2 dept_data_platform->dept_analytics_eng handled");
    const times = await owner.query("SELECT at FROM request_hops WHERE request_id = $1 ORDER BY seq", [id]);
    expect("hop at = received: hop 1 at request created, hop 2 at hop 1's event",
      times.rows.map((r) => r.at.toISOString()).join(", "), `${created.toISOString()}, ${bounced.toISOString()}`);
    await emit("request_stuck", "agent", id, at(1), { request_id: id });
    expect("request_stuck after resolved leaves it resolved",
      (await one(owner, "SELECT status FROM requests WHERE id = $1", [id])).status, "resolved");
    expect("bad hop: insert succeeded, event stored, hop skipped, warning raised",
      `${badInsert} ${(await one(owner, "SELECT count(*)::int AS n FROM events WHERE request_id = $1 AND payload->>'seq' = '9'", [id])).n} ` +
        `${(await one(owner, "SELECT count(*)::int AS n FROM request_hops WHERE request_id = $1 AND seq = 9", [id])).n} ` +
        `${warnings.some((w) => w.startsWith("events_derive skipped hop"))}`,
      "ok 1 0 true");
    // Replaying an event is ignored: same request id, same (request_id, seq).
    await emit("request_created", "p_leo", id, at(0), { request_id: id, task_type: "data_access", title: "duplicate" });
    await emit("hop", "agent", id, at(0), { request_id: id, seq: 1, from: "p_leo", to: "dept_it", outcome: "forwarded" });
    const dup = await one(owner, "SELECT (SELECT title FROM requests WHERE id = $1) AS t, (SELECT count(*)::int FROM request_hops WHERE request_id = $1) AS n", [id]);
    expect("replayed request_created and hop ignored", `${dup.t}, ${dup.n} hops`, "Warehouse access (live test), 2 hops");

    const after = await insights();
    const changed = INSIGHTS.filter((v) => before[v] !== after[v]);
    expect("Insights views changed (at least one)", changed.length > 0, true);
    console.log(`       changed: ${changed.join(", ")}`);
    const agentRow = await one(owner, "SELECT basis_count, hours FROM insights_hours_saved WHERE metric = 'agent_routing'");
    console.log(`       agent_routing now: ${agentRow.basis_count} request(s), ${agentRow.hours} h saved`);

    // HR request: text in title, note and any other key is masked for wayfinder_web; structure stays.
    const hr = "req_live_hr_test";
    await emit("request_created", "p_zoe", hr, at(2), { request_id: hr, task_type: "leave_request", title: `${HR_SECRET} title` });
    await emit("hop", "agent", hr, at(2), {
      request_id: hr, seq: 1, from: "p_zoe", to: "dept_hr", outcome: "handled", note: `${HR_SECRET} note`, text: `${HR_SECRET} text`,
    });
    await emit("message_in", "p_zoe", hr, at(2), { message: `${HR_SECRET} message`, amount_usd: 0 });
    const leak = await one(
      web,
      `SELECT count(*) FILTER (WHERE payload::text LIKE '%' || $2 || '%')::int AS leaks,
              string_agg(DISTINCT k, ',' ORDER BY k) FILTER (WHERE v <> '"[visible to HR only]"') AS kept
       FROM events_public, jsonb_each(payload) AS kv(k, v) WHERE request_id = $1`,
      [hr, HR_SECRET],
    );
    expect("events_public HR events: leaks; structural keys kept", `${leak.leaks}; ${leak.kept}`,
      "0; amount_usd,from,outcome,request_id,seq,task_type,to");
    const hrViews = await one(
      web,
      `SELECT (SELECT title FROM requests_public WHERE id = $1) AS title, (SELECT note FROM request_hops_public WHERE request_id = $1) AS note`,
      [hr],
    );
    expect("requests_public title, request_hops_public note", `${hrViews.title}, ${hrViews.note}`, "[visible to HR only], [visible to HR only]");
    const plain = await one(web, "SELECT payload->>'title' AS t FROM events_public WHERE request_id = $1 AND type = 'request_created' LIMIT 1", [id]);
    expect("non-HR live event unchanged in events_public", plain?.t, "Warehouse access (live test)");
  } finally {
    await cleanup().catch((e) => console.log(`  FAIL cleanup: ${(e as Error).message}`));
  }
  const left = await one(
    owner,
    `SELECT (SELECT count(*) FROM events WHERE request_id = ANY($1))::int + (SELECT count(*) FROM request_hops WHERE request_id = ANY($1))::int
          + (SELECT count(*) FROM requests WHERE id = ANY($1))::int AS n`,
    [LIVE_IDS],
  );
  expect("test rows left after cleanup", left.n, 0);
  const restored = await insights();
  expect("Insights views back to pre-test values", INSIGHTS.filter((v) => before[v] !== restored[v]).join(", ") || "all 5", "all 5");
  await Promise.all([owner.end(), agent.end(), web.end()]);
}

await run("wayfinder_agent", "TIGER_AGENT_PASSWORD", AGENT);
await run("wayfinder_web", "TIGER_WEB_PASSWORD", WEB);
total += AGENT.length + WEB.length + 2;
await live().catch((e) => {
  console.log(`  FAIL live: ${(e as Error).message}`);
  failures.push("live");
});
console.log(failures.length ? `FAIL: ${failures.length} of ${total} checks failed` : `PASS: ${total} of ${total} checks`);
if (failures.length) process.exitCode = 1;
