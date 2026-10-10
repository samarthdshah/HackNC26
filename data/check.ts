// Fixture check: parses every fixture, verifies references, and computes the demo stats from history.
// Run: npm --prefix data run check   (Node 22.6+ for type stripping)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { OrgEdge } from "../packages/shared/src/index.ts";

const DIR = join(import.meta.dirname, "fixtures");

interface Hop {
  seq: number;
  from: string;
  to: string;
  at: string;
  outcome: "forwarded" | "bounced" | "delegated" | "handled";
  note: string;
  redirect_to?: string;
}

interface Request {
  id: string;
  task_type: string;
  requester_id: string;
  created_at: string;
  status: "resolved" | "open";
  resolved_at: string | null;
  resolved_by: string | null;
  hops: Hop[];
  new_hire_id?: string;
  vendor_id?: string;
  room_id?: string;
}

type Row = Record<string, any>;

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);

// 1. Every JSON file parses.
const data: Record<string, any> = {};
for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  try {
    data[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  } catch (e) {
    fail(`${f}: ${(e as Error).message}`);
  }
}
const need = ["company", "departments", "people", "rooms", "bookings", "vendors", "budgets", "policies", "edges", "requests"];
for (const n of need) if (!(n in data)) fail(`missing ${n}.json`);
if (errors.length) report();

const company: Row = data.company;
const departments: Row[] = data.departments;
const people: Row[] = data.people;
const rooms: Row[] = data.rooms;
const bookings: Row[] = data.bookings;
const vendors: Row[] = data.vendors;
const budgets: Row[] = data.budgets;
const policies: Row[] = data.policies;
const edges: OrgEdge[] = data.edges;
const requests: Request[] = data.requests;

// 2. Ids are unique and every reference exists.
function idSet(name: string, rows: Row[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) {
    if (s.has(r.id)) fail(`${name}: duplicate id ${r.id}`);
    s.add(r.id);
  }
  return s;
}
const deptIds = idSet("departments", departments);
const personIds = idSet("people", people);
const roomIds = idSet("rooms", rooms);
const vendorIds = idSet("vendors", vendors);
idSet("bookings", bookings);
idSet("budgets", budgets);
idSet("policies", policies);
idSet("requests", requests as Row[]);
const actorIds = new Set([...deptIds, ...personIds]);

function ref(where: string, id: unknown, set: Set<string>, nullable = false) {
  if (id == null) {
    if (!nullable) fail(`${where}: missing reference`);
    return;
  }
  if (!set.has(id as string)) fail(`${where}: unknown id ${id}`);
}

for (const d of departments) ref(`departments.${d.id}.head_id`, d.head_id, personIds);
for (const p of people) {
  ref(`people.${p.id}.department_id`, p.department_id, deptIds);
  ref(`people.${p.id}.manager_id`, p.manager_id, personIds, true);
  ref(`people.${p.id}.delegate_id`, p.delegate_id, personIds, true);
  if (p.status === "out" && (!p.delegate_id || !p.out_until)) fail(`people.${p.id}: out without delegate_id or out_until`);
}
for (const b of bookings) {
  ref(`bookings.${b.id}.room_id`, b.room_id, roomIds);
  ref(`bookings.${b.id}.booked_by`, b.booked_by, personIds);
}
for (const v of vendors) ref(`vendors.${v.id}.owner_department_id`, v.owner_department_id, deptIds);
for (const b of budgets) {
  ref(`budgets.${b.id}.department_id`, b.department_id, deptIds);
  ref(`budgets.${b.id}.owner_id`, b.owner_id, personIds);
}
for (const p of policies) ref(`policies.${p.id}.owner_department_id`, p.owner_department_id, deptIds);

const edgeKeys = new Set<string>();
edges.forEach((e, i) => {
  const where = `edges[${i}]`;
  if (e.from !== "agent") ref(`${where}.from`, e.from, actorIds);
  ref(`${where}.to`, e.to, actorIds);
  if (!(e.confidence >= 0 && e.confidence <= 1)) fail(`${where}: confidence out of range`);
  if (e.source !== "chart" && e.source !== "learned") fail(`${where}: bad source`);
  const key = `${e.from}|${e.to}|${e.task_type}`;
  if (edgeKeys.has(key)) fail(`${where}: duplicate edge ${key}`);
  edgeKeys.add(key);
});

const demoStart = Date.parse(`${company.demo_date}T00:00:00-04:00`);
for (const r of requests) {
  const where = `requests.${r.id}`;
  ref(`${where}.requester_id`, r.requester_id, personIds);
  ref(`${where}.resolved_by`, r.resolved_by, actorIds, r.status === "open");
  ref(`${where}.new_hire_id`, r.new_hire_id, personIds, true);
  ref(`${where}.vendor_id`, r.vendor_id, vendorIds, true);
  ref(`${where}.room_id`, r.room_id, roomIds, true);
  if (!r.hops.length) fail(`${where}: no hops`);
  if (r.status === "resolved") {
    if (!r.resolved_at || Date.parse(r.resolved_at) <= Date.parse(r.created_at)) fail(`${where}: bad resolved_at`);
    if (Date.parse(r.resolved_at!) > demoStart) fail(`${where}: resolved after demo date`);
    if (r.hops.at(-1)!.outcome !== "handled") fail(`${where}: last hop not handled`);
    if (r.resolved_by !== r.hops.at(-1)!.to) fail(`${where}: resolved_by is not the last hop`);
  }
  let prevAt = Date.parse(r.created_at);
  r.hops.forEach((h, i) => {
    const hw = `${where}.hops[${i}]`;
    ref(`${hw}.from`, h.from, actorIds);
    ref(`${hw}.to`, h.to, actorIds);
    ref(`${hw}.redirect_to`, h.redirect_to, actorIds, true);
    if (h.seq !== i + 1) fail(`${hw}: seq ${h.seq}`);
    if (i === 0 && h.from !== r.requester_id) fail(`${hw}: first hop not from requester`);
    if (i > 0 && h.from !== r.hops[i - 1].to) fail(`${hw}: chain broken`);
    if ((h.outcome === "bounced" || h.outcome === "delegated") && !h.redirect_to) fail(`${hw}: ${h.outcome} without redirect_to`);
    const next = r.hops[i + 1];
    if (h.redirect_to && next && next.to !== h.redirect_to) fail(`${hw}: next hop ignores redirect_to`);
    const at = Date.parse(h.at);
    if (Number.isNaN(at) || at < prevAt) fail(`${hw}: timestamp out of order`);
    prevAt = at;
  });
}

// 3. Demo moments are seeded.
const person = (id: string) => people.find((p) => p.id === id);
const leoReq = requests.find((r) => r.requester_id === "p_leo" && r.status === "open");
const leoHop = leoReq?.hops[0];
if (!person("p_leo") || leoHop?.to !== "dept_data_platform" || leoHop.outcome !== "bounced" || leoHop.redirect_to !== "dept_analytics_eng")
  fail("demo: Leo's request does not bounce from Data Platform to Analytics Engineering");
const priya = person("p_priya");
if (priya?.status !== "out" || priya.delegate_id !== "p_tom") fail("demo: Priya is not out with Tom as delegate");
if (!edges.some((e) => e.from === "p_priya" && e.to === "p_tom" && e.delegate_until)) fail("demo: no Priya -> Tom delegate edge");
const sam = bookings.find((b) => b.booked_by === "p_sam" && b.room_id === "rm_commons");
if (!sam || sam.status !== "partially_used" || !(Date.parse(sam.used_until) < Date.parse(sam.end))) fail("demo: Sam's half-used Commons booking missing");
if (!vendors.some((v) => v.category === "catering" && v.approved)) fail("demo: no approved caterer");

// 4. Stats computed from history.
const DAY = 86400e3;
const MIN = 60e3;
const resolved = requests.filter((r) => r.status === "resolved");
const durationMs = (r: Request) => Date.parse(r.resolved_at!) - Date.parse(r.created_at);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const onboarding = resolved
  .filter((r) => r.task_type === "onboarding")
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
const last10 = onboarding.slice(0, 10);
const onbDays = avg(last10.map((r) => durationMs(r) / DAY));
const onbHops = avg(last10.map((r) => r.hops.length));
if (onboarding.length < 10) fail(`stats: only ${onboarding.length} resolved onboarding requests`);
if (Math.abs(onbDays - 4) > 0.5) fail(`stats: last 10 onboarding average ${onbDays.toFixed(2)} days, expected about 4`);
if (Math.abs(onbHops - 6) > 0.5) fail(`stats: last 10 onboarding average ${onbHops.toFixed(2)} hops, expected about 6`);

const platformIds = new Set(["dept_platform", ...people.filter((p) => p.department_id === "dept_platform").map((p) => p.id)]);
const checkout = resolved.filter((r) => r.task_type === "checkout_incident");
const direct = checkout.filter((r) => platformIds.has(r.hops[0].to));
const routed = checkout.filter((r) => !platformIds.has(r.hops[0].to));
const directMin = avg(direct.map((r) => durationMs(r) / MIN));
const routedMin = avg(routed.map((r) => durationMs(r) / MIN));
if (checkout.length !== 6) fail(`demo: expected 6 checkout incidents, found ${checkout.length}`);
if (!direct.length || !routed.length) fail("stats: need both direct and routed checkout incidents");
else if (!(directMin < routedMin)) fail("stats: direct-to-Platform checkout incidents are not faster");

console.log("Fixture counts:");
for (const n of need) console.log(`  ${n}: ${Array.isArray(data[n]) ? data[n].length : 1}`);
console.log(`Onboarding: ${onboarding.length} resolved; last 10 average ${onbDays.toFixed(2)} days, ${onbHops.toFixed(2)} hops`);
console.log(
  `Checkout incidents: ${checkout.length}; paged Platform directly ${direct.length} avg ${directMin.toFixed(0)} min, ` +
    `routed via other teams ${routed.length} avg ${routedMin.toFixed(0)} min (avg hops ${avg(direct.map((r) => r.hops.length)).toFixed(1)} vs ${avg(routed.map((r) => r.hops.length)).toFixed(1)})`,
);
report();

function report(): never {
  if (errors.length) {
    console.error(`FAIL: ${errors.length} problem(s)`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("PASS");
  process.exit(0);
}
