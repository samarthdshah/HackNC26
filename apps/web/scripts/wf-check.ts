// Drift guard for the web adapter. Run: npm run wf:check -w @wayfinder/web
//   1. Fixtures: build WF and check the seed values documented in data/tiger/SCHEMA.md.
//   2. Tiger (when TIGER_DATABASE_URL + TIGER_WEB_PASSWORD are set): build WF from Tiger and
//      compare every number against Tiger's own insights_* views, so TS and SQL can't drift.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import type { WF } from "@wayfinder/shared";
import { buildWF } from "../lib/wf/build.ts";
import { loadFixtures } from "../lib/wf/fixtures.ts";
import { loadTiger, tigerConfigured } from "../lib/wf/tiger.ts";

const env = resolve(process.cwd(), "../../.env");
if (existsSync(env)) process.loadEnvFile(env);

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`);
}

function seedChecks(wf: WF, requests: number) {
  const s = wf.stats;
  const dp = wf.byDept.find((d) => d.id === "dept_data_platform")!;
  check("departments / people", [s.departments, wf.people.length], [10, 24]);
  check("requests", s.requestsRouted, requests);
  check("new hires", s.newHires, { requests: 10, avg_days: 4.01, avg_hops: 6 });
  check("checkout", s.checkout, [
    { path: "direct", incidents: 2, avg_minutes: 43, avg_hops: 2 },
    { path: "routed", incidents: 4, avg_minutes: 233, avg_hops: 3.8 },
  ]);
  check("bottleneck #1", [wf.byDept[0].name, wf.byDept[0].totalHours], ["Analytics Engineering", 829.7]);
  check("Data Platform bounced", [dp.bounces, dp.bouncePct, dp.hoursLost], [22, 100, 341.3]);
  check("hours lost to bounces", s.hoursLost, 537.6);
  check("hours saved (checkout direct paging)", s.hoursSaved - s.agentSaved, 12.7);
}

console.log("— fixtures");
const fx = buildWF(loadFixtures());
seedChecks(fx, 84);
check("Leo's queries", fx.queries.map((q) => q.id), ["req_demo_leo"]);
check("Leo's query ends waiting on Analytics Eng", fx.queries[0]?.hops.at(-1)?.who, "dept_analytics_eng");
check("HR titles masked", fx.allQueries.every((q) => !q.hr || q.title === "[visible to HR only]"), true);

if (tigerConfigured()) {
  console.log("\n— tiger (TS adapter vs Tiger's insights_* views)");
  const tw = buildWF(await loadTiger());
  const u = new URL(process.env.TIGER_DATABASE_URL!);
  const db = new pg.Client({
    host: u.hostname, port: Number(u.port || 5432), database: u.pathname.slice(1) || "tsdb", user: "wayfinder_web",
    password: process.env.TIGER_WEB_PASSWORD, ssl: { rejectUnauthorized: process.env.TIGER_TLS_INSECURE !== "1" },
  });
  await db.connect();
  const q = async (sql: string) => (await db.query(sql)).rows;
  const [nh] = await q("select * from insights_new_hires");
  check("new hires = view", tw.stats.newHires, { requests: nh.requests, avg_days: Number(nh.avg_days), avg_hops: Number(nh.avg_hops) });
  const co = await q("select * from insights_checkout");
  check("checkout = view", tw.stats.checkout, co.map((r) => ({ path: r.path, incidents: r.incidents, avg_minutes: Number(r.avg_minutes), avg_hops: Number(r.avg_hops) })));
  const bn = await q("select * from insights_bottlenecks order by rank");
  check("bottlenecks = view", tw.byDept.filter((d) => d.totalHours > 0 || d.bounces > 0).map((d) => [d.id, d.totalHours, d.bounces, d.hoursLost]),
    bn.map((r) => [r.department_id, Number(r.total_hours), r.bounces, Number(r.bounce_hours)]));
  const hs = Object.fromEntries((await q("select metric, hours from insights_hours_saved")).map((r) => [r.metric, Number(r.hours)]));
  check("hours lost = view", tw.stats.hoursLost, hs.bounces);
  check("hours saved = view", tw.stats.hoursSaved, Math.round((hs.checkout_direct_paging + hs.agent_routing) * 10) / 10);
  const [{ n }] = await q("select count(*)::int as n from requests_public");
  check("requests = view", tw.stats.requestsRouted, n);
  await db.end();
} else {
  console.log("\n(tiger not configured: skipped the SQL comparison)");
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
