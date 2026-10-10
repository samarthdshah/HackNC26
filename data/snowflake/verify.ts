// Verify Snowflake SQL API access with a Programmatic Access Token.
// Cortex is unavailable on the trial account (REST 003001, SQL 399258), so it is not checked.
// Run: npm --prefix data run snowflake:verify
// Auth headers per https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/authentication

import { fileURLToPath } from "node:url";

process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));

const REQUIRED = ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_PAT", "SNOWFLAKE_ROLE", "SNOWFLAKE_WAREHOUSE"];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const account = process.env.SNOWFLAKE_ACCOUNT!.toLowerCase().replace(/_/g, "-");
const base = `https://${account}.snowflakecomputing.com`;
const headers = {
  Authorization: `Bearer ${process.env.SNOWFLAKE_PAT}`,
  "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
  "Content-Type": "application/json",
  Accept: "application/json",
};

function short(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 300);
}

type SqlResult = { ok: true; rows: string[][] } | { ok: false; status: number; code: string; message: string };

async function runSql(statement: string): Promise<SqlResult> {
  const res = await fetch(`${base}/api/v2/statements`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      statement,
      timeout: 60,
      role: process.env.SNOWFLAKE_ROLE,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    }),
  });
  const text = await res.text();
  if (res.status === 200) return { ok: true, rows: JSON.parse(text).data };
  let code = "";
  let message = text;
  try {
    ({ code, message } = JSON.parse(text));
  } catch {}
  return { ok: false, status: res.status, code, message: short(message) };
}

async function sqlCheck(): Promise<boolean> {
  const r = await runSql("SELECT CURRENT_REGION(), CURRENT_ROLE(), CURRENT_WAREHOUSE()");
  if (!r.ok) {
    console.log(`SQL API: FAILED (HTTP ${r.status}, code ${r.code}) ${r.message}`);
    return false;
  }
  const [region, role, warehouse] = r.rows[0];
  console.log(`SQL API: OK  region=${region}  role=${role}  warehouse=${warehouse}`);
  return true;
}

process.exit((await sqlCheck()) ? 0 : 1);
