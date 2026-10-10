// Create the Tiger logins: apply roles.sql (roles + grants), then set LOGIN and the passwords from .env.
// Passwords go to Postgres as SCRAM-SHA-256 verifiers computed here, so the plain text never leaves this machine.
// Run: npm --prefix data run tiger:roles (safe to rerun; tiger:seed re-applies the grants but not the passwords).

import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
const ROLES: [string, string][] = [
  ["wayfinder_agent", "TIGER_AGENT_PASSWORD"],
  ["wayfinder_web", "TIGER_WEB_PASSWORD"],
];
const missing = ["TIGER_DATABASE_URL", ...ROLES.map(([, env]) => env)].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// Postgres SCRAM-SHA-256 verifier format: SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>
function scram(password: string): string {
  const salt = randomBytes(16);
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const hmac = (key: Buffer, text: string) => createHmac("sha256", key).update(text).digest();
  const stored = createHash("sha256").update(hmac(salted, "Client Key")).digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${stored.toString("base64")}:${hmac(salted, "Server Key").toString("base64")}`;
}

const client = new pg.Client({ connectionString: process.env.TIGER_DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(readFileSync(new URL("roles.sql", import.meta.url), "utf8"));
  for (const [role, env] of ROLES) {
    await client.query(`ALTER ROLE ${role} LOGIN PASSWORD ${client.escapeLiteral(scram(process.env[env]!))}`);
    console.log(`ok  ${role}: grants applied, LOGIN, password from ${env}`);
  }
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`FAIL: rolled back. ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
