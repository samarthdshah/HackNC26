// Phase 0 voice handoff: render a line with ElevenLabs and send it to DEMO_PHONE
// as an iMessage voice note. Run: npm run voice:test -w @wayfinder/agent -- "optional text"

import { Spectrum, voice } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { required } from "../src/env.ts";
import { emit } from "../src/events.ts";
import { tts } from "../src/voice/elevenlabs.ts";

const phone = required("DEMO_PHONE");
const line = process.argv.slice(2).join(" ") || "Hey, it's Wayfinder. If you can hear this, the voice handoff works.";

const app = await Spectrum({
  projectId: required("PHOTON_PROJECT_ID"),
  projectSecret: required("PHOTON_PROJECT_SECRET"),
  providers: [imessage.config()],
});

try {
  const audio = await tts(line);
  console.log(`[voice] ElevenLabs rendered ${audio.length} bytes`);
  const space = await imessage(app).space.create(phone);
  await space.send(voice(audio, { mimeType: "audio/mpeg", name: "wayfinder.mp3" }));
  emit("message_out", "agent", { kind: "voice", to: phone, bytes: audio.length });
  console.log(`[voice] sent to ${phone}`);
} finally {
  await app.stop();
}
