// Prove the POL-ACCESS-1 rules from roles.sql by querying as each tier role through the SQL API "role" field.
// Run after snowflake:roles: npm --prefix data run snowflake:test-roles
// As lane A's user (WAYFINDER_AGENT), with SNOWFLAKE_AGENT_PAT: npm --prefix data run snowflake:test-roles -- --agent-pat
// Same checks and expected results, minus the ACCOUNTADMIN-only ones.

import { requireEnv, runSql, usePat, type SqlResult } from "./client.ts";

requireEnv(["SNOWFLAKE_DATABASE", "SNOWFLAKE_SCHEMA"]);
const AGENT_PAT = process.argv.includes("--agent-pat");
if (AGENT_PAT) usePat("SNOWFLAKE_AGENT_PAT");
const ctx = { database: process.env.SNOWFLAKE_DATABASE, schema: process.env.SNOWFLAKE_SCHEMA };

const MASK = "[visible to HR only]";
const LEAVE_TITLE = "Parental leave starting in August"; // req_0078

// Approved role mapping (STATE.md, S3 roles).
const EXPECTED_ROLES: Record<string, string[]> = {
  PHOTON_VP: ["p_dana"],
  PHOTON_MANAGER: ["p_grace", "p_jess", "p_maya", "p_marcus", "p_raj", "p_priya", "p_nina", "p_felix"],
  PHOTON_FINANCE: ["p_hannah", "p_ben"],
  PHOTON_HR_HEAD: ["p_teresa"],
  PHOTON_HR: ["p_andre"],
  PHOTON_EMPLOYEE: ["p_omar", "p_ken", "p_luis", "p_aisha", "p_elena", "p_tom", "p_zoe", "p_victor", "p_sam", "p_leo", "p_imani"],
};

// Dana's question: "Why do new hires take so long to get set up?"
const VP_QUESTION = `
  SELECT ROUND(AVG(DATEDIFF('second', created_at, resolved_at)) / 86400, 2), ROUND(AVG(hop_count), 2)
  FROM (SELECT * FROM requests WHERE task_type = 'onboarding' AND status = 'resolved' ORDER BY created_at DESC LIMIT 10)`;

// role undefined = no role in the request body (the user's default role). agentOnly: runs only under --agent-pat.
// knownRisk: a failure is reported as KNOWN RISK (see SCHEMA.md) and does not fail the run.
type Test = {
  name: string; role?: string; sql: string; expect: string; check: (r: SqlResult) => boolean; agentOnly?: boolean; knownRisk?: boolean;
};

const refused = (r: SqlResult) => !r.ok && r.code === "002003";
const firstCell = (r: SqlResult) => (r.ok ? r.rows[0]?.[0] : undefined);

const TESTS: Test[] = [
  { name: "EMPLOYEE reads budgets", role: "PHOTON_EMPLOYEE", sql: "SELECT COUNT(*) FROM budgets", expect: "refused", check: refused },
  { name: "MANAGER reads budgets", role: "PHOTON_MANAGER", sql: "SELECT COUNT(*) FROM budgets", expect: "8 rows", check: (r) => firstCell(r) === "8" },
  { name: "VP reads budgets", role: "PHOTON_VP", sql: "SELECT COUNT(*) FROM budgets", expect: "8 rows", check: (r) => firstCell(r) === "8" },
  { name: "FINANCE reads requests", role: "PHOTON_FINANCE", sql: "SELECT COUNT(*) FROM requests", expect: "refused", check: refused },
  ...[
    ["HR", "PHOTON_HR", LEAVE_TITLE],
    ["HR_HEAD", "PHOTON_HR_HEAD", LEAVE_TITLE],
    ["MANAGER", "PHOTON_MANAGER", MASK],
    ["VP", "PHOTON_VP", MASK],
  ].map(([who, role, title]): Test => ({
    name: `${who} reads req_0078 title`,
    role,
    sql: "SELECT title FROM requests WHERE id = 'req_0078'",
    expect: title,
    check: (r) => firstCell(r) === title,
  })),
  {
    name: "EMPLOYEE reads req_0078 title",
    role: "PHOTON_EMPLOYEE",
    sql: "SELECT title FROM requests WHERE id = 'req_0078'",
    expect: "refused",
    check: refused,
  },
  {
    name: "HR reads req_0078 hop notes",
    role: "PHOTON_HR",
    sql: `SELECT COUNT(*), COUNT_IF(note = '${MASK}') FROM request_hops WHERE request_id = 'req_0078'`,
    expect: "3 notes, 0 masked",
    check: (r) => r.ok && r.rows[0][0] === "3" && r.rows[0][1] === "0",
  },
  {
    name: "HR reads request_hops for req_0001",
    role: "PHOTON_HR",
    sql: "SELECT COUNT(*) FROM request_hops WHERE request_id = 'req_0001'",
    expect: "0 rows",
    check: (r) => firstCell(r) === "0",
  },
  {
    name: "HR reads requests for req_0001",
    role: "PHOTON_HR",
    sql: "SELECT COUNT(*) FROM requests WHERE id = 'req_0001'",
    expect: "0 rows",
    check: (r) => firstCell(r) === "0",
  },
  {
    name: "VP (Dana) asks the new-hire question",
    role: "PHOTON_VP",
    sql: VP_QUESTION,
    expect: "about 4 days, 6 hops",
    check: (r) => r.ok && Math.abs(Number(r.rows[0][0]) - 4) <= 0.5 && Math.abs(Number(r.rows[0][1]) - 6) <= 0.5,
  },
  { name: "EMPLOYEE (Leo) asks the new-hire question", role: "PHOTON_EMPLOYEE", sql: VP_QUESTION, expect: "refused", check: refused },
  {
    name: "VP reads vp_new_hire_setup summary",
    role: "PHOTON_VP",
    sql: "SELECT requests, avg_days, avg_hops FROM vp_new_hire_setup WHERE section = 'summary'",
    expect: "10, 4.01, 6.00",
    check: (r) => r.ok && r.rows.length === 1 && r.rows[0].join(", ") === "10, 4.01, 6.00",
  },
  {
    name: "VP reads vp_new_hire_setup slowest handoff",
    role: "PHOTON_VP",
    sql: "SELECT from_name, to_name, avg_hours FROM vp_new_hire_setup WHERE section = 'slowest_handoff' AND rank = 1",
    expect: "IT, Analytics Engineering, 19.0",
    check: (r) => r.ok && r.rows.length === 1 && r.rows[0].join(", ") === "IT, Analytics Engineering, 19.0",
  },
  {
    name: "VP reads vp_new_hire_setup top bouncer",
    role: "PHOTON_VP",
    sql: "SELECT department, bounces, bounced_to FROM vp_new_hire_setup WHERE section = 'bouncing_department' AND rank = 1",
    expect: "Data Platform, 6, Analytics Engineering",
    check: (r) => r.ok && r.rows.length === 1 && r.rows[0].join(", ") === "Data Platform, 6, Analytics Engineering",
  },
  ...[
    ["MANAGER", "PHOTON_MANAGER"],
    ["HR_HEAD", "PHOTON_HR_HEAD"],
    ["FINANCE", "PHOTON_FINANCE"],
    ["EMPLOYEE", "PHOTON_EMPLOYEE"],
  ].map(([who, role]): Test => ({
    name: `${who} reads vp_new_hire_setup`,
    role,
    sql: "SELECT COUNT(*) FROM vp_new_hire_setup",
    expect: "refused",
    check: refused,
  })),
  // Lane A reference data through PHOTON_FINANCE (inherits EMPLOYEE): every non-person table.
  ...[
    ["company", "1"], ["departments", "10"], ["rooms", "6"], ["vendors", "6"], ["budgets", "8"], ["policies", "11"],
  ].map(([table, n]): Test => ({
    name: `FINANCE reads ${table}`,
    role: "PHOTON_FINANCE",
    sql: `SELECT COUNT(*) FROM ${table}`,
    expect: `${n} rows`,
    check: (r) => firstCell(r) === n,
  })),
  {
    name: "APP reads resolution_by_task_type",
    role: "PHOTON_APP",
    sql: `SELECT COUNT(*), SUM(request_count),
                 MAX(IFF(task_type = 'onboarding', request_count || ' / ' || avg_hops, NULL)),
                 COUNT_IF(task_type IN ('leave_request', 'benefits_question', 'employee_relations'))
          FROM resolution_by_task_type`,
    expect: "17 types, 83 requests, onboarding 14 / 6.43 hops, 3 HR types",
    check: (r) => r.ok && r.rows[0].join(", ") === "17, 83, 14 / 6.43, 3",
  },
  ...[
    ["VP", "PHOTON_VP"],
    ["MANAGER", "PHOTON_MANAGER"],
    ["EMPLOYEE", "PHOTON_EMPLOYEE"],
  ].map(([who, role]): Test => ({
    name: `${who} reads resolution_by_task_type`,
    role,
    sql: "SELECT COUNT(*) FROM resolution_by_task_type",
    expect: "refused",
    check: refused,
  })),
  // Each statement runs as the named tier role only: no secondary roles, so PHOTON_HR is not in an EMPLOYEE or
  // MANAGER session (HR text stays masked). Under the agent PAT the user must be WAYFINDER_AGENT.
  ...[
    ["EMPLOYEE", "PHOTON_EMPLOYEE"],
    ["MANAGER", "PHOTON_MANAGER"],
  ].map(([who, role]): Test => ({
    name: `${who} session: user, role, secondary roles, PHOTON_HR in session`,
    role,
    sql: "SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_SECONDARY_ROLES(), IS_ROLE_IN_SESSION('PHOTON_HR')",
    expect: `${AGENT_PAT ? "WAYFINDER_AGENT" : "owner"}, ${role}, none, false`,
    check: (r) =>
      r.ok &&
      (!AGENT_PAT || r.rows[0][0] === "WAYFINDER_AGENT") &&
      r.rows[0][1] === role &&
      JSON.parse(r.rows[0][2] ?? "{}").roles === "" &&
      r.rows[0][3] === "false",
  })),
  // Wanted fail safe: with no role in the body, WAYFINDER_AGENT should not get PHOTON_APP. Known risk: the PAT's
  // PHOTON_APP role restriction overrides DEFAULT_ROLE, so today these run as PHOTON_APP. Lane A must always send a role.
  {
    name: "no-role session: role, secondary roles, PHOTON_HR in session",
    sql: "SELECT CURRENT_ROLE(), CURRENT_SECONDARY_ROLES(), IS_ROLE_IN_SESSION('PHOTON_HR')",
    expect: "PHOTON_EMPLOYEE, none, false",
    check: (r) => r.ok && r.rows[0][0] === "PHOTON_EMPLOYEE" && JSON.parse(r.rows[0][1] ?? "{}").roles === "" && r.rows[0][2] === "false",
    agentOnly: true,
    knownRisk: true,
  },
  { name: "no-role SELECT on requests", sql: "SELECT COUNT(*) FROM requests", expect: "refused", check: refused, agentOnly: true, knownRisk: true },
  {
    name: "WAYFINDER_AGENT granted roles",
    role: "ACCOUNTADMIN",
    sql: "SHOW GRANTS TO USER WAYFINDER_AGENT",
    expect: "PHOTON_APP + 6 tier roles",
    check: (r) =>
      r.ok &&
      r.rows.map((row) => row[3]).sort().join(",") ===
        "PHOTON_APP,PHOTON_EMPLOYEE,PHOTON_FINANCE,PHOTON_HR,PHOTON_HR_HEAD,PHOTON_MANAGER,PHOTON_VP",
  },
];

function describe(r: SqlResult): string {
  if (!r.ok) return `refused (${r.code})` + (r.code === "002003" ? "" : `: ${r.message.slice(0, 80)}`);
  if (!r.rows.length) return "no rows";
  return r.rows[0].join(", ");
}

const results: [string, string, string, string, boolean][] = [];
const risks = new Set<string>();
// The agent PAT cannot use ACCOUNTADMIN, so admin-only checks run under the owner PAT only.
for (const t of TESTS.filter((t) => (AGENT_PAT ? t.role !== "ACCOUNTADMIN" : !t.agentOnly))) {
  const r = await runSql(t.sql, { ...ctx, role: t.role });
  const pass = t.check(r);
  if (!pass && t.knownRisk) risks.add(t.name);
  results.push([t.name, t.role ?? "(none)", t.expect, describe(r), pass || !!t.knownRisk]);
}

// person_roles: every person must map to exactly the approved role.
const expected = new Map(Object.entries(EXPECTED_ROLES).flatMap(([role, ids]) => ids.map((id) => [id, role] as const)));
const pr = await runSql("SELECT person_id, role_name FROM person_roles ORDER BY person_id", { ...ctx, role: "PHOTON_APP" });
const mismatches: string[] = [];
if (!pr.ok) mismatches.push(`person_roles unreadable as PHOTON_APP: ${pr.code} ${pr.message}`);
else {
  const actual = new Map(pr.rows.map(([id, role]) => [id!, role!]));
  for (const [id, role] of expected) if (actual.get(id) !== role) mismatches.push(`${id}: expected ${role}, got ${actual.get(id) ?? "missing"}`);
  for (const id of actual.keys()) if (!expected.has(id)) mismatches.push(`${id}: not in approved mapping`);
}
results.push(["person_roles matches approved mapping", "PHOTON_APP", `${expected.size} people, 0 mismatches`, pr.ok ? `${pr.rows.length} people, ${mismatches.length} mismatches` : "unreadable", mismatches.length === 0]);

console.log(`PAT: ${AGENT_PAT ? "SNOWFLAKE_AGENT_PAT" : "SNOWFLAKE_PAT"}`);
console.log("| Test | Role | Expected | Actual | Result |\n|---|---|---|---|---|");
for (const [name, role, expect, actual, pass] of results) {
  console.log(`| ${name} | ${role} | ${expect} | ${actual} | ${risks.has(name) ? "KNOWN RISK" : pass ? "PASS" : "FAIL"} |`);
}
for (const m of mismatches) console.log(`  mismatch: ${m}`);
// Report only: what a statement with no role in the request body runs as (the user's default role).
const bare = await runSql("SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_SECONDARY_ROLES(), IS_ROLE_IN_SESSION('PHOTON_HR')", { ...ctx, role: undefined });
console.log(`No role in request body: ${bare.ok ? bare.rows[0].join(", ") : `refused (${bare.code}) ${bare.message.slice(0, 80)}`}`);
const failed = results.filter((r) => !r[4]).length;
const passed = results.length - failed - risks.size;
console.log(failed ? `${failed} of ${results.length} FAILED` : `${passed} of ${results.length} passed` + (risks.size ? `, ${risks.size} known risk (no-role statements run as PHOTON_APP)` : "."));
process.exit(failed ? 1 : 0);
