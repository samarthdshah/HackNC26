// ElevenLabs text-to-speech over REST. Used for voice notes now, briefings later.

import { env, required } from "../env.ts";

const BASE = "https://api.elevenlabs.io/v1";

/** Renders `text` to an MP3 buffer. */
export async function tts(text: string): Promise<Buffer> {
  const res = await fetch(
    `${BASE}/text-to-speech/${env.elevenlabs.voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": required("ELEVENLABS_API_KEY"),
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: env.elevenlabs.model }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Cheap authenticated call for key checks. */
export async function listVoices(): Promise<{ voice_id: string; name: string }[]> {
  const res = await fetch(`${BASE}/voices`, {
    headers: { "xi-api-key": required("ELEVENLABS_API_KEY") },
  });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { voices: { voice_id: string; name: string }[] };
  return body.voices;
}
