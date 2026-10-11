// Tiny WebAudio synth shared by the aquarium lamp, the ring toss and Shel. No samples: every
// sound is a couple of oscillators with an envelope, so nothing is fetched.

export type Sfx = "jump" | "doubleJump" | "coin" | "heal" | "stomp" | "hurt" | "win" | "pump" | "ring" | "click" | "lose";

let ctx: AudioContext | null = null;
let muted = false;

function ac() {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(a: AudioContext, type: OscillatorType, from: number, to: number, at: number, dur: number, vol = 0.12) {
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(a: AudioContext, at: number, dur: number, vol = 0.1, hz = 900) {
  const n = Math.ceil(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + at;
  s.buffer = buf; f.type = "lowpass"; f.frequency.value = hz; g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination);
  s.start(t);
}

export function play(kind: Sfx) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  switch (kind) {
    case "jump": tone(a, "square", 330, 660, 0, 0.14, 0.07); break;
    case "doubleJump": tone(a, "square", 520, 1040, 0, 0.12, 0.07); tone(a, "triangle", 780, 1560, 0.05, 0.1, 0.05); break;
    case "coin": tone(a, "square", 988, 988, 0, 0.07, 0.06); tone(a, "square", 1319, 1319, 0.07, 0.16, 0.06); break;
    case "heal": [523, 659, 784, 1047].forEach((f, i) => tone(a, "triangle", f, f, i * 0.07, 0.14, 0.09)); break;
    case "stomp": tone(a, "square", 220, 60, 0, 0.12, 0.09); noise(a, 0, 0.08, 0.08, 600); break;
    case "hurt": tone(a, "sawtooth", 440, 110, 0, 0.3, 0.08); break;
    case "lose": [392, 330, 262, 196].forEach((f, i) => tone(a, "triangle", f, f * 0.98, i * 0.16, 0.2, 0.09)); break;
    case "win": [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(a, "square", f, f, i * 0.11, 0.16, 0.06)); break;
    case "pump": noise(a, 0, 0.22, 0.06, 1400); tone(a, "sine", 180, 320, 0, 0.18, 0.05); break;
    case "ring": tone(a, "sine", 1568, 1568, 0, 0.35, 0.07); tone(a, "sine", 2093, 2093, 0.04, 0.3, 0.04); break;
    case "click": tone(a, "triangle", 900, 600, 0, 0.05, 0.08); break;
  }
}

export const setMuted = (m: boolean) => { muted = m; };
export const isMuted = () => muted;
