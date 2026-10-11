// Apply roles.sql (roles, grants, row access, HR masking, person_roles, service user) through the SQL API.
// Every statement runs as ACCOUNTADMIN, whatever SNOWFLAKE_ROLE says: npm --prefix data run snowflake:roles
// Rerun after every snowflake:load, since replacing tables drops grants and policy attachments.

import { readFileSync } from "node:fs";
import { mustSql, requireEnv, short } from "./client.ts";

requireEnv(["SNOWFLAKE_DATABASE", "SNOWFLAKE_SCHEMA"]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const vars: Record<string, string> = {
  DATABASE: process.env.SNOWFLAKE_DATABASE!,
  SCHEMA: process.env.SNOWFLAKE_SCHEMA!,
  WAREHOUSE: process.env.SNOWFLAKE_WAREHOUSE!,
};
for (const [name, value] of Object.entries(vars)) {
  if (!IDENT.test(value)) {
    console.error(`SNOWFLAKE_${name} must be a plain identifier (letters, digits, _ or $)`);
    process.exit(1);
  }
}

// Strip comments, fill placeholders, split on statement-ending semicolons. roles.sql has no semicolons in strings.
const statements = readFileSync(new URL("roles.sql", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k])
  .split(/;\s*(?:\n|$)/)
  .map((s) => s.trim())
  .filter(Boolean);

// Creating roles, users, and policies needs ACCOUNTADMIN, so the role is pinned here rather than read from .env.
const ADMIN_ROLE = "ACCOUNTADMIN";
const ctx = { database: vars.DATABASE, schema: vars.SCHEMA, role: ADMIN_ROLE };
for (const [i, statement] of statements.entries()) {
  await mustSql(statement, ctx);
  console.log(`${String(i + 1).padStart(2)}/${statements.length} ok  ${short(statement).slice(0, 90)}`);
}
console.log(`Applied ${statements.length} statements to ${vars.DATABASE}.${vars.SCHEMA} as ${ADMIN_ROLE}.`);
