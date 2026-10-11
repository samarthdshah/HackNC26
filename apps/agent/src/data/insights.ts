// Questions answered from Snowflake request history, always as the asker's own
// tier role (PHOTON.ORG.PERSON_ROLES). If Snowflake refuses, we pass the refusal
// on; the app never filters by role itself.

import { personRoles } from "./fixtures.ts";
import { isAccessDenied, runSql, snowflakeConfigured, type SqlResult } from "./snowflake.ts";

/** Unknown people get the least-privileged role. */
export const roleFor = (personId: string) => personRoles[personId] ?? "PHOTON_EMPLOYEE";

type Refusal = { refused: true; by: "Snowflake"; role: string; message: string };
type Failure = { error: string };

function outcome<T>(r: SqlResult, role: string, map: (rows: (string | null)[][]) => T): T | Refusal | Failure {
  if (r.ok) return map(r.rows);
  if (isAccessDenied(r)) return { refused: true, by: "Snowflake", role, message: r.message };
  return { error: `${r.code}: ${r.message}` };
}

/** VP-only: why new hires take so long (PHOTON.ORG.VP_NEW_HIRE_SETUP). */
export async function newHireSetup(asker: string) {
  if (!snowflakeConfigured()) return { error: "Snowflake not configured" };
  const role = roleFor(asker);
  const r = await runSql(
    `select section, rank, requests, avg_days, avg_hops, from_name, to_name, department, bounced_to,
            handoffs, bounces, avg_hours, total_hours, pct_of_time
       from VP_NEW_HIRE_SETUP order by section, rank`,
    role,
  );
  return outcome(r, role, (rows) => {
    const pick = (section: string) => rows.filter((x) => x[0] === section);
    const [summary] = pick("summary");
    return {
      role,
      last_10_new_hires: summary && { requests: Number(summary[2]), avg_days_to_set_up: Number(summary[3]), avg_hops: Number(summary[4]) },
      bouncing_departments: pick("bouncing_department").map((x) => ({
        department: x[7], sends_back_to: x[8], bounces: Number(x[10]), hours_lost: Number(x[12]), pct_of_time: Number(x[13]),
      })),
      slowest_handoffs: pick("slowest_handoff").slice(0, 5).map((x) => ({
        from: x[5], to: x[6], handoffs: Number(x[9]), avg_hours: Number(x[11]), pct_of_time: Number(x[13]),
      })),
      note: "Simulated company data (Photon).",
    };
  });
}

/** Managers and up: resolution time and hops by task type (PHOTON.ORG.REQUESTS). */
export async function requestHistory(asker: string, taskType?: string) {
  if (!snowflakeConfigured()) return { error: "Snowflake not configured" };
  const role = roleFor(asker);
  const filter = taskType ? `and task_type = '${taskType.replace(/[^a-z_]/g, "")}'` : "";
  const r = await runSql(
    `select task_type, count(*) as resolved,
            round(avg(datediff('minute', created_at, resolved_at)) / 60, 1) as avg_hours,
            round(avg(hop_count), 2) as avg_hops
       from requests where status = 'resolved' ${filter}
      group by 1 order by 2 desc`,
    role,
  );
  return outcome(r, role, (rows) => ({
    role,
    by_task_type: rows.map((x) => ({ task_type: x[0], resolved: Number(x[1]), avg_hours: Number(x[2]), avg_hops: Number(x[3]) })),
    note: "Simulated company data (Photon).",
  }));
}
