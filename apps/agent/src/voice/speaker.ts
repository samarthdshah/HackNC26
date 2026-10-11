// The terminal's voice: speaks text aloud on this machine with ElevenLabs. Clips are
// cached in logs/tts by content, so repeated lines cost no credits. Plays with afplay
// (macOS) or ffplay; queued so lines never talk over each other.
// Turn on with TERMINAL_VOICE=on in .env, or /speak on in the terminal chat.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "../env.ts";
import { tts } from "./elevenlabs.ts";

const dir = fileURLToPath(new URL("../../logs/tts/", import.meta.url));
let enabled = env.terminalVoice;
let queue: Promise<void> = Promise.resolve();
let warned = false;

export const speaking = () => enabled;
export function setSpeaking(on: boolean) {
  enabled = on;
}

/** Make text sound right spoken: links become "link", emoji and markup go. */
export function spoken(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

async function clip(text: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = `${dir}${createHash("sha1").update(`${env.elevenlabs.voiceId}|${text}`).digest("hex")}.mp3`;
  if (!existsSync(file)) writeFileSync(file, await tts(text));
  return file;
}

function play(file: string): Promise<void> {
  const [cmd, args] = process.platform === "darwin" ? ["afplay", [file]] : ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file]];
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("error", () => {
      if (!warned) console.warn(`[voice] can't play audio here (${cmd} not found)`);
      warned = true;
      resolve();
    });
    p.on("close", () => resolve());
  });
}

/** Speak a line aloud (queued). `force` speaks even when terminal voice is off (e.g. /summary). */
export function speak(text: string, opts: { force?: boolean } = {}): Promise<void> {
  if (!enabled && !opts.force) return Promise.resolve();
  const line = spoken(text);
  if (!line) return Promise.resolve();
  queue = queue.then(async () => play(await clip(line))).catch((err) => console.warn(`[voice] ${err instanceof Error ? err.message : err}`));
  return queue;
}
