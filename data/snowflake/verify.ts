// Verify Snowflake SQL API access with a Programmatic Access Token.
// Cortex is unavailable on the trial account (REST 003001, SQL 399258), so it is not checked.
// Run: npm --prefix data run snowflake:verify

import { runSql } from "./client.ts";

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
