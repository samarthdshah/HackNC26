// Connect as each Tiger login and check what it can and cannot do. Every check runs inside one transaction per role
// that is rolled back, so nothing is written. Denied means Postgres error 42501 (permission denied); any other error fails.
// Run: npm --prefix data run tiger:test-roles (after tiger:roles)

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

async function run(role: string, passwordEnv: string, checks: Check[]) {
  const url = new URL(process.env.TIGER_DATABASE_URL!);
  url.username = role;
  url.password = encodeURIComponent(process.env[passwordEnv]!);
  const client = new pg.Client({ connectionString: url.toString() });
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

await run("wayfinder_agent", "TIGER_AGENT_PASSWORD", AGENT);
await run("wayfinder_web", "TIGER_WEB_PASSWORD", WEB);
const total = AGENT.length + WEB.length + 2;
console.log(failures.length ? `FAIL: ${failures.length} of ${total} checks failed` : `PASS: ${total} of ${total} checks`);
if (failures.length) process.exitCode = 1;
