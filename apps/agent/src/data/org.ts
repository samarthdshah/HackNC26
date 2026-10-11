// Loads org reference data from Snowflake PHOTON.ORG into data/fixtures.ts.
// Falls back to the JSON fixtures (and says so) if Snowflake is not reachable.

import { setOrgData, type Budget, type Department, type Person, type Policy, type Room, type Vendor } from "./fixtures.ts";
import { env } from "../env.ts";
import { rows, snowflakeConfigured, type Row } from "./snowflake.ts";

const arr = (v: string | null): string[] => (v ? (JSON.parse(v) as string[]) : []);
const num = (v: string | null) => (v === null ? 0 : Number(v));
const bool = (v: string | null) => v === "true";

export async function loadOrgData(): Promise<{ source: "snowflake" | "fixtures"; detail: string }> {
  if (!snowflakeConfigured()) return { source: "fixtures", detail: "Snowflake not configured" };
  try {
    const [companyRows, peopleRows, deptRows, budgetRows, vendorRows, policyRows, roomRows, roleRows, typicalRows] = await Promise.all([
      rows(`select name, domain, timezone, to_varchar(demo_date) from company`),
      rows(`select id, name, email, department_id, role, manager_id, status, to_varchar(out_until), delegate_id,
                   access_role, skills from people order by id`),
      rows(`select id, name, head_id, cost_center, charter from departments order by id`),
      rows(`select id, department_id, category, period, amount_usd, spent_usd, owner_id from budgets order by id`),
      rows(`select id, name, category, contact_name, contact_email, approved, preferred, owner_department_id,
                   lead_time_hours, pricing, payment_methods from vendors order by id`),
      rows(`select id, title, text from policies order by id`),
      rows(`select id, name, floor, capacity, features from rooms order by id`),
      rows(`select * from person_roles`, env.snowflake.appRole),
      // Aggregate-only view for lane A; C grants it to PHOTON_APP only.
      rows(
        `select task_type, request_count, avg_resolution_hours, median_resolution_hours, avg_hops from resolution_by_task_type`,
        env.snowflake.appRole,
      ).catch(() => [] as Row[]),
    ]);
    const [c] = companyRows;
    setOrgData({
      company: { name: c[0]!, domain: c[1]!, timezone: c[2]!, demo_date: c[3]! },
      people: peopleRows.map(
        (r: Row): Person => ({
          id: r[0]!, name: r[1]!, email: r[2]!, department_id: r[3]!, role: r[4]!, manager_id: r[5],
          status: r[6] === "out" ? "out" : "active", out_until: r[7], delegate_id: r[8], access_role: r[9]!, skills: arr(r[10]),
        }),
      ),
      departments: deptRows.map((r): Department => ({ id: r[0]!, name: r[1]!, head_id: r[2]!, cost_center: r[3]!, charter: r[4]! })),
      budgets: budgetRows.map(
        (r): Budget => ({ id: r[0]!, department_id: r[1]!, category: r[2]!, period: r[3]!, amount_usd: num(r[4]), spent_usd: num(r[5]), owner_id: r[6]! }),
      ),
      vendors: vendorRows.map(
        (r): Vendor => ({
          id: r[0]!, name: r[1]!, category: r[2]!, contact_name: r[3]!, contact_email: r[4]!, approved: bool(r[5]), preferred: bool(r[6]),
          owner_department_id: r[7]!, lead_time_hours: num(r[8]), pricing: r[9]!, payment_methods: arr(r[10]),
        }),
      ),
      policies: policyRows.map((r): Policy => ({ id: r[0]!, title: r[1]!, text: r[2]! })),
      rooms: roomRows.map((r): Room => ({ id: r[0]!, name: r[1]!, floor: num(r[2]), capacity: num(r[3]), features: arr(r[4]) })),
      personRoles: Object.fromEntries(roleRows.map((r) => [r[0]!, r[1]!])),
      typical: Object.fromEntries(
        typicalRows.map((r) => [r[0]!, { requests: num(r[1]), avg_hours: num(r[2]), median_hours: num(r[3]), avg_hops: num(r[4]) }]),
      ),
    });
    return {
      source: "snowflake",
      detail: `${peopleRows.length} people, ${deptRows.length} departments, ${roleRows.length} role mappings, ${typicalRows.length} task-type baselines, as ${env.snowflake.patOwner}`,
    };
  } catch (err) {
    console.warn(`[org] Snowflake load failed, using fixtures: ${err instanceof Error ? err.message : err}`);
    return { source: "fixtures", detail: `Snowflake failed: ${err instanceof Error ? err.message : err}` };
  }
}
