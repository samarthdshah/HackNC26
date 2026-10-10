// Pings every Lane A service with the keys in .env and prints a pass/fail table.
// Run: npm run check:keys -w @wayfinder/agent

import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { ask } from "../src/brain/gemini.ts";
import { env, required } from "../src/env.ts";
import { listAccounts } from "../src/money/nessie.ts";
import { balanceSol, wallet } from "../src/money/solana.ts";
import { listVoices } from "../src/voice/elevenlabs.ts";

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
