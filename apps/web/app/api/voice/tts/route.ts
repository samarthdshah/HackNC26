// Text to speech for the website (voice tour, Currents summary) with ElevenLabs.
// The key never reaches the browser; clips are cached on disk by voice + text, so
// replaying a tour costs no credits.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE = join(process.cwd(), ".next", "cache", "avatar-voice");
const MAX_CHARS = 1200;

/** POST /api/voice/tts { text } → audio/mpeg */
export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_API_KEY is not set in the root .env" }, { status: 503 });
  let text = "";
  try { text = String(((await req.json()) as { text?: unknown }).text ?? "").trim(); } catch { /* handled below */ }
  if (!text) return Response.json({ error: "text is required" }, { status: 400 });
  text = text.slice(0, MAX_CHARS);

  const voice = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
  const model = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";
  const file = join(CACHE, createHash("sha1").update(`${voice}|${model}|${text}`).digest("hex") + ".mp3");
  const headers = { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" };

  try { return new Response(new Uint8Array(await readFile(file)), { headers }); } catch { /* not cached yet */ }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: model }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err: unknown) => err as Error);
  if (res instanceof Error) return Response.json({ error: `ElevenLabs not reachable: ${res.message}` }, { status: 502 });
  if (!res.ok) return Response.json({ error: `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });

  const audio = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE, { recursive: true }).then(() => writeFile(file, audio)).catch(() => {});
  return new Response(new Uint8Array(audio), { headers });
}
