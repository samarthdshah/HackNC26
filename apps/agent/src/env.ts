// Loads the repo-root .env into process.env and exposes typed config.
// Anything already exported in the shell wins over .env.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

function optional(name: string, fallback = ""): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/** Throws a readable error when a key the caller needs is missing. */
export function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`${name} is not set. Add it to .env at the repo root.`);
  return value;
}

/** The owner's password when TIGER_DATABASE_URL is the owner's own connection string. */
function ownerFromUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return u.username === "tsdbadmin" ? decodeURIComponent(u.password) : "";
  } catch {
    return "";
  }
}

export const env = {
  gemini: {
    apiKey: optional("GEMINI_API_KEY"),
    model: optional("GEMINI_MODEL", "gemini-flash-latest"),
  },
  photon: {
    projectId: optional("PHOTON_PROJECT_ID"),
    projectSecret: optional("PHOTON_PROJECT_SECRET"),
  },
  surfaces: optional("SURFACES", "imessage,terminal")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  demoPhone: optional("DEMO_PHONE"),
  // How long to wait on an owner or approver before nudging, and how many
  // nudges before escalating. Compressed for the demo.
  reminderMs: Number(optional("REMINDER_MS", "120000")),
  maxReminders: Number(optional("MAX_REMINDERS", "2")),
  elevenlabs: {
    apiKey: optional("ELEVENLABS_API_KEY"),
    voiceId: optional("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8EDAkf"),
    model: optional("ELEVENLABS_MODEL", "eleven_flash_v2_5"),
  },
  nessie: {
    apiKey: optional("NESSIE_API_KEY"),
    baseUrl: optional("NESSIE_BASE_URL", "https://api.nessieisreal.com"),
  },
  solana: {
    rpcUrl: optional("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
    secretKey: optional("SOLANA_SECRET_KEY"),
    // Demo conversion so devnet balances last: $176 lunch -> 0.0176 SOL
    solPerUsd: Number(optional("SOLANA_SOL_PER_USD", "0.0001")),
  },
  calls: {
    // Live outbound calls via ElevenLabs Conversational AI + a phone number.
    // Without these, the voice agent role-plays the call and says so.
    agentId: optional("ELEVENLABS_AGENT_ID"),
    phoneNumberId: optional("ELEVENLABS_PHONE_NUMBER_ID"),
    vendorPhone: optional("VENDOR_PHONE"),
  },
  briefingAt: optional("BRIEFING_AT"), // "08:30" local time, empty = off
  snowflake: {
    account: optional("SNOWFLAKE_ACCOUNT"),
    // WAYFINDER_AGENT's own PAT (lane C) when set; the owner PAT is only a fallback.
    pat: optional("SNOWFLAKE_AGENT_PAT") || optional("SNOWFLAKE_PAT"),
    patOwner: optional("SNOWFLAKE_AGENT_PAT") ? "WAYFINDER_AGENT" : "owner PAT",
    warehouse: optional("SNOWFLAKE_WAREHOUSE"),
    database: optional("SNOWFLAKE_DATABASE", "PHOTON"),
    schema: optional("SNOWFLAKE_SCHEMA", "ORG"),
    // Startup reads (directory, budgets, vendors, policies): least role that sees them all.
    orgRole: optional("SNOWFLAKE_ORG_ROLE", "PHOTON_FINANCE"),
    // Service role allowed to read PERSON_ROLES and switch into tier roles.
    appRole: optional("SNOWFLAKE_APP_ROLE", "PHOTON_APP"),
  },
  darwinUrl: optional("DARWIN_URL"),
  // GET /live (SSE) and /health for the website (Lane B)
  port: Number(optional("AGENT_PORT", "8787")),
  corsOrigin: optional("AGENT_CORS_ORIGIN", "*"),
  /** Bearer token the website sends on POST /say and /intro. Unset: only localhost may call them. */
  webToken: optional("AGENT_WEB_TOKEN", ""),
  tiger: {
    url: optional("TIGER_DATABASE_URL"), // host and database; the user comes from below
    // Lane A's own login (data/tiger/SCHEMA.md). TIGER_PASSWORD keeps the URL's user instead.
    user: optional("TIGER_AGENT_PASSWORD") ? "wayfinder_agent" : "",
    password: optional("TIGER_AGENT_PASSWORD") || optional("TIGER_PASSWORD"),
    // Owner login, only for scripts/tiger-test.ts (inspect and clean up test rows)
    ownerPassword: optional("TIGER_OWNER_PASSWORD") || ownerFromUrl(optional("TIGER_DATABASE_URL")),
    // Only if your network intercepts TLS and certificate verification fails
    insecureTls: optional("TIGER_TLS_INSECURE") === "1",
  },
} as const;
