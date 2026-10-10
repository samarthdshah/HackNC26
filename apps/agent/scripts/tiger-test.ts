// Live check of the Tiger integration: runs Leo's warehouse-access request with
// Tiger enabled, prints exactly what landed in Lane C's tables, then deletes the
// rows this run wrote (pass --keep to leave them for the Insights page).
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
url.password = encodeURIComponent(env.tiger.password);
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: !env.tiger.insecureTls } });
await db.connect();
const show = async (label: string, sql: string) => console.log(`\n${label}`, (await db.query(sql, [id])).rows);
await show("requests:", `select id, task_type, title, requester_id, status, resolved_by, origin, hr_sensitive from requests where id = $1`);
await show("request_hops:", `select seq, from_id, to_id, outcome, redirect_to, note from request_hops where request_id = $1 order by seq`);
await show("learned edges:", `select from_id, to_id, task_type, confidence, source, learned_from from org_edges where learned_from = $1`);
await show("events:", `select type, count(*)::int from events where request_id = $1 group by 1 order by 1`);
await show("insights_hours_saved (agent_routing):", `select basis_count, hours from insights_hours_saved where metric = 'agent_routing' and $1::text is not null`);

if (!keep) {
  await db.query(`delete from request_hops where request_id = $1`, [id]);
  await db.query(`delete from requests where id = $1`, [id]);
  await db.query(`delete from events where request_id = $1`, [id]);
  resetMap(); // drops learned edges in Tiger and restores chart confidences
  await tiger.tigerFlushed();
  console.log(`\nCleaned up ${id} and restored the chart map.`);
}
await db.end();
await tiger.closeTiger();
process.exit(0);
