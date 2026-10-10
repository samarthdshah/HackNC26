// Pings every Lane A service with the keys in .env and prints a pass/fail table.
// Run: npm run check:keys -w @wayfinder/agent

import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { ask } from "../src/brain/gemini.ts";
import { env, required } from "../src/env.ts";
import { listAccounts } from "../src/money/nessie.ts";
import { balanceSol, wallet } from "../src/money/solana.ts";
import { listVoices } from "../src/voice/elevenlabs.ts";
import { loadOrgData } from "../src/data/org.ts";
import { newHireSetup } from "../src/data/insights.ts";
import { closeTiger, tigerConfigured, tigerReady } from "../src/data/tiger.ts";

const checks: [string, () => Promise<string>][] = [
  ["Gemini", async () => `${env.gemini.model} says "${await ask("Reply with the single word: ok")}"`],
  [
    "Photon Spectrum",
    async () => {
      const app = await Spectrum({
        projectId: required("PHOTON_PROJECT_ID"),
        projectSecret: required("PHOTON_PROJECT_SECRET"),
        providers: [imessage.config()],
      });
      const name = app.config.name ?? env.photon.projectId;
      await app.stop();
      return `project ${name}`;
    },
  ],
  [
    "ElevenLabs",
    async () => {
      const voices = await listVoices();
      const chosen = voices.find((v) => v.voice_id === env.elevenlabs.voiceId);
      return `${voices.length} voices · ELEVENLABS_VOICE_ID ${chosen ? `= ${chosen.name}` : "NOT in your library"}`;
    },
  ],
  ["Nessie", async () => `${(await listAccounts()).length} accounts visible`],
  [
    "Snowflake",
    async () => {
      const org = await loadOrgData();
      if (org.source !== "snowflake") throw new Error(org.detail);
      const vp = await newHireSetup("p_dana");
      const leo = await newHireSetup("p_leo");
      const vpOk = "last_10_new_hires" in vp;
      const leoRefused = "refused" in leo;
      if (!vpOk || !leoRefused) throw new Error(`role check off: VP ok=${vpOk}, employee refused=${leoRefused}`);
      return `${org.detail} · VP view ok, employee refused by Snowflake`;
    },
  ],
  [
    "Tiger Data",
    async () => {
      if (!tigerConfigured()) throw new Error("TIGER_DATABASE_URL and TIGER_PASSWORD needed");
      const ok = await tigerReady();
      await closeTiger();
      if (!ok) throw new Error("not reachable, or Lane C's tables are missing (see warning above)");
      return "events, org_edges, requests, request_hops ready";
    },
  ],
  [
    "Solana devnet",
    async () => `${(await wallet()).address} · ${(await balanceSol()).toFixed(3)} SOL`,
  ],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    console.log(`✅ ${name.padEnd(16)} ${await run()}`);
  } catch (err) {
    failed++;
    console.log(`❌ ${name.padEnd(16)} ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(failed ? 1 : 0);
