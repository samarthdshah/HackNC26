// Minimal Snowflake SQL API client with Programmatic Access Token auth (fetch only).
// Auth headers per https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/authentication

import { fileURLToPath } from "node:url";

process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));

export function requireEnv(names: string[]): void {
  const missing = names.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

requireEnv(["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_PAT", "SNOWFLAKE_ROLE", "SNOWFLAKE_WAREHOUSE"]);

const account = process.env.SNOWFLAKE_ACCOUNT!.toLowerCase().replace(/_/g, "-");
const base = `https://${account}.snowflakecomputing.com`;
const headers = {
  Authorization: `Bearer ${process.env.SNOWFLAKE_PAT}`,
  "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
  "Content-Type": "application/json",
  Accept: "application/json",
};

export function short(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 300);
}

export type SqlResult =
  | { ok: true; rows: (string | null)[][] }
  | { ok: false; status: number; code: string; message: string };

export type SqlOptions = {
  bindings?: Record<string, { type: string; value: string }>;
  database?: string;
  schema?: string;
};

async function parse(res: Response): Promise<SqlResult | { pending: string }> {
  const text = await res.text();
  if (res.status === 200) return { ok: true, rows: JSON.parse(text).data ?? [] };
  if (res.status === 202) return { pending: JSON.parse(text).statementHandle };
  let code = "";
  let message = text;
  try {
    ({ code, message } = JSON.parse(text));
  } catch {}
  return { ok: false, status: res.status, code, message: short(message) };
}

export async function runSql(statement: string, opts: SqlOptions = {}): Promise<SqlResult> {
  let result = await parse(
    await fetch(`${base}/api/v2/statements`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        statement,
        timeout: 60,
        role: process.env.SNOWFLAKE_ROLE,
        warehouse: process.env.SNOWFLAKE_WAREHOUSE,
        ...opts,
      }),
    }),
  );
  // Long statements return 202 with a handle; poll until done.
  while ("pending" in result) {
    await new Promise((r) => setTimeout(r, 1000));
    result = await parse(await fetch(`${base}/api/v2/statements/${result.pending}`, { headers }));
  }
  return result;
}

// Like runSql, but exits on failure. For scripts that cannot continue past an error.
export async function mustSql(statement: string, opts: SqlOptions = {}): Promise<(string | null)[][]> {
  const r = await runSql(statement, opts);
  if (!r.ok) {
    console.error(`SQL failed (HTTP ${r.status}, code ${r.code}) ${r.message}\n  in: ${short(statement)}`);
    process.exit(1);
  }
  return r.rows;
}
