// Live check of the Tiger integration: runs Leo's warehouse-access request with
// Tiger enabled, prints what Lane C's events trigger derived (requests, hops) and
// the edge history, then deletes this run's rows (pass --keep to leave them for
// the Insights page). Verifying and cleaning up need the owner login; as
// wayfinder_agent the run still happens but can't be inspected from here.
//   npm run tiger:test -w @wayfinder/agent [-- --keep]

export {};
process.env.REMINDER_MS ??= "600000";
const keep = process.argv.includes("--keep");

const { initMessenger } = await import("../src/messenger.ts");
const { handleInbound } = await import("../src/graph/supervisor.ts");
const { bind } = await import("../src/org/directory.ts");
const { nameOf } = await import("../src/org/entities.ts");
const { idle, listRequests, resetRunner } = await import("../src/graph/runner.ts");
const { resetMap, syncMapFromTiger } = await import("../src/org/map.ts");
const { loadOrgData } = await import("../src/data/org.ts");
const tiger = await import("../src/data/tiger.ts");
const pg = (await import("pg")).default;
const { env } = await import("../src/env.ts");

// Reading requests/hops and deleting test rows needs the owner; wayfinder_agent can do neither,
// and leaving test rows behind would skew the team's Insights. So no owner, no test.
if (!env.tiger.ownerPassword) {
  console.error("Needs the owner login: put tsdbadmin's password in TIGER_DATABASE_URL or TIGER_OWNER_PASSWORD; it reads and cleans up.");
  process.exit(1);
}
if (!(await tiger.tigerReady())) {
  console.error("Tiger is not ready (see warning above).");
  process.exit(1);
}
initMessenger({ sink: (to, text) => console.log(`   📨 → ${nameOf(to)}: ${text.slice(0, 110)}`) });
await loadOrgData();
console.log(`map from ${await syncMapFromTiger()}`);
resetRunner();
for (const n of ["leo", "raj", "tom"]) bind(`p_${n}`, { platform: "sim", id: n });
const say = async (who: string, text: string) => {
  console.log(`💬 ${nameOf(`p_${who}`)}: ${text}`);
  await handleInbound({ platform: "sim", id: who }, text);
  await idle();
};

await say("leo", "can I get warehouse access for the curated marts?");
await say("raj", "not us, try Analytics Engineering");
await say("tom", "done, granted ANALYST");
await tiger.tigerFlushed();

const id = listRequests().at(-1)!.id;
const url = new URL(env.tiger.url);
url.searchParams.delete("sslmode");
url.username = "tsdbadmin";
url.password = encodeURIComponent(env.tiger.ownerPassword);
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: !env.tiger.insecureTls } });
await db.connect();
const show = async (label: string, sql: string) => console.log(`\n${label}`, (await db.query(sql, [id])).rows);
await show("requests (from trigger):", `select id, task_type, title, requester_id, status, resolved_by, origin, hr_sensitive from requests where id = $1`);
await show("request_hops (from hop events):", `select seq, from_id, to_id, outcome, redirect_to, to_char(at, 'HH24:MI:SS') at from request_hops where request_id = $1 order by seq`);
await show("org_edge_changes:", `select from_id, to_id, task_type, previous_confidence prev, confidence, source, reason from org_edge_changes where request_id = $1 order by id`);
await show("events:", `select type, count(*)::int from events where request_id = $1 group by 1 order by 1`);
await show("insights_hours_saved:", `select metric, basis_count, hours from insights_hours_saved where $1::text is not null`);

if (!keep) {
  try {
    resetMap(); // puts demoted chart edges back and zeroes learned ones (with "reset" change rows)
    await tiger.tigerFlushed();
    await db.query(`delete from request_hops where request_id = $1`, [id]);
    await db.query(`delete from requests where id = $1`, [id]);
    await db.query(`delete from events where request_id = $1`, [id]);
    await db.query(`delete from org_edge_changes where request_id = $1`, [id]);
    await db.query(`delete from org_edges where source = 'learned' and learned_from = $1`, [id]);
    await db.query(`delete from org_edge_changes where reason = 'reset' and request_id is null and changed_at > now() - interval '5 minutes'`);
    console.log(`\nCleaned up ${id} and restored the chart map.`);
  } catch (err) {
    console.log(`\nCould not clean up (${(err as Error).message}); ask lane C to run tiger:seed, or rerun with the owner login.`);
  }
}
await db.end();
await tiger.closeTiger();
process.exit(0);
