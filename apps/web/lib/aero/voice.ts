// Browser side of AVATAR's voice: one shared <audio> element, unlocked on a click so later
// lines can play after page changes (client-side navigation keeps the same document).

let audio: HTMLAudioElement | undefined;
let current: { stop: () => void } | undefined;
const cache = new Map<string, Promise<string>>(); // text → object URL

/** A 10 ms silent WAV, built here so it's always valid: playing it on a click unlocks audio. */
function silence(): string {
  const n = 80, buf = new DataView(new ArrayBuffer(44 + n)), str = (o: number, t: string) => [...t].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); buf.setUint32(4, 36 + n, true); str(8, "WAVEfmt "); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, 8000, true); buf.setUint32(28, 8000, true); buf.setUint16(32, 1, true); buf.setUint16(34, 8, true); str(36, "data"); buf.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf.setUint8(44 + i, 128);
  return "data:audio/wav;base64," + btoa(String.fromCharCode(...new Uint8Array(buf.buffer)));
}

/** Call from a click handler before any narration, so the browser allows audio later. */
export function unlockVoice() {
  audio ??= new Audio();
  audio.src = silence();
  void audio.play().catch(() => {});
}

function clip(text: string): Promise<string> {
  let p = cache.get(text);
  if (!p) {
    p = fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `voice ${r.status}`);
      return URL.createObjectURL(await r.blob());
    });
    p.catch(() => cache.delete(text));
    cache.set(text, p);
  }
  return p;
}

/** Fetch a line ahead of time so it starts instantly when it's needed. */
export function prefetchVoice(text: string) {
  void clip(text).catch(() => {});
}

/** Speak a line; resolves when it finishes (or is stopped). Rejects if it couldn't be voiced. */
export async function speakLine(text: string): Promise<void> {
  stopVoice();
  audio ??= new Audio();
  const a = audio;
  let stopped = false;
  const done = new Promise<void>((resolve) => { current = { stop: () => { stopped = true; resolve(); } }; a.onended = () => resolve(); a.onerror = () => resolve(); });
  const url = await clip(text);
  if (stopped) return;
  a.src = url;
  await a.play();
  return done;
}

export function stopVoice() {
  current?.stop();
  current = undefined;
  if (audio) { audio.pause(); audio.onended = null; }
}
