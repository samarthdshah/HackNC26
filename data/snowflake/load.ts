// Load the Photon fixtures into Snowflake through the SQL API. Re-runnable: tables are replaced.
// Bookings and edges are live data and live in Tiger Data, so they are not loaded here.
// Run: npm --prefix data run snowflake:load

import { readFileSync } from "node:fs";
import { mustSql, requireEnv, type SqlOptions } from "./client.ts";

requireEnv(["SNOWFLAKE_DATABASE", "SNOWFLAKE_SCHEMA"]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const database = process.env.SNOWFLAKE_DATABASE!;
const schema = process.env.SNOWFLAKE_SCHEMA!;
for (const [name, value] of [["SNOWFLAKE_DATABASE", database], ["SNOWFLAKE_SCHEMA", schema]]) {
  if (!IDENT.test(value)) {
    console.error(`${name} must be a plain identifier (letters, digits, _ or $)`);
    process.exit(1);
  }
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
}

// Column: [name, Snowflake type, expression over the JSON row `v`].
type Column = [string, string, string];
type Table = { name: string; rows: unknown[]; columns: Column[]; from?: string };

// Plain columns read the same-named JSON field.
function col(name: string, type: string, field = name): Column {
  return [name, type, `v:${field}::${type}`];
}

const requests = fixture("requests") as { hops: unknown[] }[];

const TABLES: Table[] = [
  {
    name: "company",
    rows: [fixture("company")],
    columns: [
      col("name", "STRING"),
      col("domain", "STRING"),
      col("timezone", "STRING"),
      col("demo_date", "DATE"),
      col("history_start", "DATE"),
      col("note", "STRING"),
    ],
  },
  {
    name: "departments",
    rows: fixture("departments") as unknown[],
    columns: [
      col("id", "STRING"),
      col("name", "STRING"),
      col("head_id", "STRING"),
      col("cost_center", "STRING"),
      col("charter", "STRING"),
    ],
  },
  {
    name: "people",
    rows: fixture("people") as unknown[],
    columns: [
      col("id", "STRING"),
      col("name", "STRING"),
      col("email", "STRING"),
      col("department_id", "STRING"),
      col("role", "STRING"),
      col("manager_id", "STRING"),
      col("status", "STRING"),
      col("out_until", "DATE"),
      col("delegate_id", "STRING"),
      col("start_date", "DATE"),
      col("location", "STRING"),
      col("access_role", "STRING"),
      col("skills", "ARRAY"),
    ],
  },
  {
    name: "rooms",
    rows: fixture("rooms") as unknown[],
    columns: [
      col("id", "STRING"),
      col("name", "STRING"),
      col("floor", "INTEGER"),
      col("capacity", "INTEGER"),
      col("features", "ARRAY"),
    ],
  },
  {
    name: "vendors",
    rows: fixture("vendors") as unknown[],
    columns: [
      col("id", "STRING"),
      col("name", "STRING"),
      col("category", "STRING"),
      col("contact_name", "STRING"),
      col("contact_email", "STRING"),
      col("approved", "BOOLEAN"),
      col("preferred", "BOOLEAN"),
      col("owner_department_id", "STRING"),
      col("lead_time_hours", "INTEGER"),
      col("pricing", "STRING"),
      col("payment_methods", "ARRAY"),
    ],
  },
  {
    name: "budgets",
    rows: fixture("budgets") as unknown[],
    columns: [
      col("id", "STRING"),
      col("department_id", "STRING"),
      col("category", "STRING"),
      col("period", "STRING"),
      col("amount_usd", "NUMBER(12,2)"),
      col("spent_usd", "NUMBER(12,2)"),
      col("owner_id", "STRING"),
    ],
  },
  {
    name: "policies",
    rows: fixture("policies") as unknown[],
    columns: [
      col("id", "STRING"),
      col("title", "STRING"),
      col("owner_department_id", "STRING"),
      col("updated", "DATE"),
      col("text", "STRING"),
    ],
  },
  {
    name: "requests",
    rows: requests,
    columns: [
      col("id", "STRING"),
      col("task_type", "STRING"),
      col("title", "STRING"),
      col("requester_id", "STRING"),
      col("created_at", "TIMESTAMP_TZ"),
      col("status", "STRING"),
      col("resolved_at", "TIMESTAMP_TZ"),
      col("resolved_by", "STRING"),
      col("resolution", "STRING"),
      col("severity", "STRING"),
      col("new_hire_name", "STRING"),
      col("new_hire_id", "STRING"),
      col("room_id", "STRING"),
      col("vendor_id", "STRING"),
      col("amount_usd", "NUMBER(12,2)"),
      ["hop_count", "INTEGER", "ARRAY_SIZE(v:hops)"],
    ],
  },
  {
    // One row per hop, flattened from each request's hop chain.
    name: "request_hops",
    rows: requests,
    from: ", LATERAL FLATTEN(input => r.value:hops) h",
    columns: [
      ["request_id", "STRING", "v:id::STRING"],
      ["seq", "INTEGER", "h.value:seq::INTEGER"],
      ["from_id", "STRING", "h.value:from::STRING"],
      ["to_id", "STRING", "h.value:to::STRING"],
      ["at", "TIMESTAMP_TZ", "h.value:at::TIMESTAMP_TZ"],
      ["outcome", "STRING", "h.value:outcome::STRING"],
      ["redirect_to", "STRING", "h.value:redirect_to::STRING"],
      ["note", "STRING", "h.value:note::STRING"],
    ],
  },
];

function expectedCount(t: Table): number {
  return t.name === "request_hops" ? requests.reduce((n, r) => n + r.hops.length, 0) : t.rows.length;
}

await mustSql(`CREATE DATABASE IF NOT EXISTS ${database}`);
await mustSql(`CREATE SCHEMA IF NOT EXISTS ${database}.${schema}`);
const ctx: SqlOptions = { database, schema };

for (const t of TABLES) {
  const ddl = t.columns.map(([name, type]) => `${name} ${type}`).join(", ");
  await mustSql(`CREATE OR REPLACE TABLE ${t.name} (${ddl})`, ctx);
  // The whole table goes in as one JSON binding; Snowflake flattens it into typed rows.
  const select = t.columns.map(([, , expr]) => expr.replace(/\bv:/g, "r.value:")).join(", ");
  await mustSql(
    `INSERT INTO ${t.name} SELECT ${select} FROM TABLE(FLATTEN(input => PARSE_JSON(?))) r${t.from ?? ""}`,
    { ...ctx, bindings: { "1": { type: "TEXT", value: JSON.stringify(t.rows) } } },
  );
}

console.log(`Loaded into ${database}.${schema}`);
console.log("table           fixture  snowflake");
let mismatches = 0;
for (const t of TABLES) {
  const [[count]] = await mustSql(`SELECT COUNT(*) FROM ${t.name}`, ctx);
  const expected = expectedCount(t);
  const match = Number(count) === expected;
  if (!match) mismatches++;
  console.log(`${t.name.padEnd(15)} ${String(expected).padStart(7)}  ${String(count).padStart(9)}${match ? "" : "  MISMATCH"}`);
}
console.log(mismatches ? `${mismatches} table(s) mismatched` : "All row counts match.");
process.exit(mismatches ? 1 : 0);
