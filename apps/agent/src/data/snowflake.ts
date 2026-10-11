// Snowflake SQL API client for the agent (PAT auth, fetch only).
// Every statement names a tier role explicitly. Startup reads use
// SNOWFLAKE_ORG_ROLE; anything answered for a person runs as *their* tier role
// from PHOTON.ORG.PERSON_ROLES, so Snowflake (not app code) decides what they see.

import { env } from "../env.ts";

export type Row = (string | null)[];
export type SqlResult = { ok: true; rows: Row[] } | { ok: false; status: number; code: string; message: string };

export const snowflakeConfigured = () => Boolean(env.snowflake.account && env.snowflake.pat && env.snowflake.warehouse);

const base = () => `https://${env.snowflake.account.toLowerCase().replace(/_/g, "-")}.snowflakecomputing.com`;
const headers = () => ({
  Authorization: `Bearer ${env.snowflake.pat}`,
  "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
  "Content-Type": "application/json",
  Accept: "application/json",
});

async function parse(res: Response): Promise<SqlResult | { pending: string }> {
  const text = await res.text();
  if (res.status === 200) return { ok: true, rows: JSON.parse(text).data ?? [] };
  if (res.status === 202) return { pending: JSON.parse(text).statementHandle };
  let code = "";
  let message = text;
  try {
    ({ code, message } = JSON.parse(text));
  } catch {}
  return { ok: false, status: res.status, code, message: message.replace(/\s+/g, " ").slice(0, 300) };
}

export async function runSql(statement: string, role: string): Promise<SqlResult> {
  let result = await parse(
    await fetch(`${base()}/api/v2/statements`, {
      method: "POST",
      headers: headers(),
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        statement,
        timeout: 30,
        role,
        warehouse: env.snowflake.warehouse,
        database: env.snowflake.database,
        schema: env.snowflake.schema,
      }),
    }),
  );
  while ("pending" in result) {
    await new Promise((r) => setTimeout(r, 800));
    result = await parse(await fetch(`${base()}/api/v2/statements/${result.pending}`, { headers: headers() }));
  }
  return result;
}

/** Throwing variant for startup loads. */
export async function rows(statement: string, role = env.snowflake.orgRole): Promise<Row[]> {
  const r = await runSql(statement, role);
  if (!r.ok) throw new Error(`Snowflake ${r.status} ${r.code}: ${r.message}`);
  return r.rows;
}

/** Snowflake's "you can't see this" family: missing grant or object hidden from the role. */
export const isAccessDenied = (r: SqlResult) => !r.ok && (r.code === "002003" || r.code === "003001" || /not authorized|insufficient privileges/i.test(r.message));
