// "Shel in Frutiger Aero": an 8-bit platformer on a 640×320 canvas. Shel double-jumps across an
// Aero eco-city, collects 10 orbs, stomps ghosts, bumps kitty blocks for healing shells and
// reaches her vampire boyfriend at the end. Every sprite is drawn here; sounds come from ./sfx.

import { play } from "./sfx";

export type ShelKey = "left" | "right" | "jump";
export type ShelApi = { destroy(): void; press(k: ShelKey, down: boolean): void; restart(): void; setPaused(p: boolean): void };

const W = 640, H = 320, T = 16, COLS = 160, ROWS = 20, STEP = 1000 / 60;
const SOLID = "GDBKU";
const MAX_LIVES = 5;

type Mode = "title" | "play" | "over" | "win";
type Ghost = { x: number; y: number; x0: number; dir: number; t: number; dead: number };
type Shell = { x: number; y: number; ty: number; taken: boolean };
type Orb = { x: number; y: number; taken: boolean };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; col: string; heart?: boolean };

/* ============ Level: built in code so every row stays the same width ============ */
function level() {
  const g: string[][] = Array.from({ length: ROWS }, () => Array<string>(COLS).fill("."));
  const set = (x: number, y: number, c: string) => { if (x >= 0 && x < COLS && y >= 0 && y < ROWS) g[y][x] = c; };
  const ground = (x0: number, x1: number, top = 17) => { for (let x = x0; x <= x1; x++) { set(x, top, "G"); for (let y = top + 1; y < ROWS; y++) set(x, y, "D"); } };
  const plat = (x0: number, x1: number, y: number) => { for (let x = x0; x <= x1; x++) set(x, y, "B"); };

  ground(0, 22); plat(16, 19, 13); set(12, 13, "K");
  ground(27, 50); plat(38, 41, 12); plat(44, 46, 9);
  plat(53, 54, 14);
  ground(57, 80); ground(64, 72, 15); set(68, 11, "K");
  plat(82, 84, 12);
  ground(86, 110); for (let y = 13; y <= 16; y++) plat(92, 93, y); plat(100, 103, 12);
  ground(116, 140); set(120, 13, "K"); plat(134, 137, 12);
  ground(141, 159); ground(150, 159, 15);

  const at = (c: number, r: number) => ({ x: c * T + 3, y: r * T + 3 });
  const orbs: Orb[] = [[8, 14], [39, 11], [45, 8], [62, 14], [77, 14], [83, 10], [92, 12], [101, 11], [128, 14], [135, 11]]
    .map(([c, r]) => ({ ...at(c, r), taken: false }));
  const ghosts: Ghost[] = [[34, 15], [60, 15], [75, 15], [98, 15], [105, 15], [125, 15], [132, 15]]
    .map(([c, r]) => ({ x: c * T, y: r * T, x0: c * T, dir: -1, t: c * 7, dead: -1 }));
  return { g, orbs, ghosts, start: { x: 3 * T, y: 15 * T }, goal: { x: 155 * T, y: 15 * T - 20, w: 12, h: 20 } };
}

/* ============ Sprites: palette bitmaps rendered once to offscreen canvases ============ */
const SHEL_TOP = [
  "....hhhh....", "..hhhhhhhc..", ".hhhhhhhhcc.", ".hHssssssHh.", ".hsessssesh.", ".hsessssesh.", ".hhsrsssshh.", "..hsssssshh.",
  "...PppppP...", "..sPppppPs..", "..sppwwpps..", "...pppppp...",
];
const SHEL_LEGS = [
  ["..wwwwwwww..", "...ww..ww...", "...bb..bb...", "..bbb..bbb.."],
  ["..wwwwwwww..", "..ww....ww..", ".bb......bb.", ".b........b."],
  ["..wwwwwwww..", "....wwww....", "....bbbb....", "...bb..bb..."],
];
const SHEL_PAL: Record<string, string> = { h: "#2BB7C9", H: "#1B8A99", c: "#FF9EC4", s: "#FFDCC8", e: "#13294A", r: "#E0508A", p: "#FF7FB0", P: "#E0508A", w: "#FFFFFF", b: "#6B4BA8" };
const VAMP = [
  "....kkkk....", "..kkkkkkkk..", ".kkkkkkkkkk.", ".kkffffffkk.", ".kfeffffefk.", ".kffffffffk.", "..ffwffwff..", "...ffffff...",
  "..cccccccc..", ".KccwwwwccK.", "KKKkwrrwkKKK", "KKKkwwwwkKKK", "KKKkkkkkkKKK", "KKKkkkkkkKKK", "KKKkkkkkkKKK", ".KKkkkkkkKK.",
  "..Kkk..kkK..", "...kk..kk...", "...kk..kk...", "..kkk..kkk..",
];
const VAMP_PAL: Record<string, string> = { k: "#1B1530", K: "#3A1E5A", c: "#C2305E", f: "#F3E8F0", e: "#C2305E", w: "#FFFFFF", r: "#E0508A" };

function bitmap(rows: string[], pal: Record<string, string>) {
  const c = document.createElement("canvas"); c.width = 12; c.height = rows.length;
  const x = c.getContext("2d")!;
  rows.forEach((row, y) => [...row.padEnd(12, ".").slice(0, 12)].forEach((ch, i) => { if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i, y, 1, 1); } }));
  return c;
}

function tileCanvas(draw: (x: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas"); c.width = T; c.height = T; draw(c.getContext("2d")!); return c;
}
function dirt(x: CanvasRenderingContext2D) {
  x.fillStyle = "#C8925A"; x.fillRect(0, 0, T, T);
  x.fillStyle = "#B07C48"; [[2, 3], [9, 6], [5, 11], [12, 13], [13, 2]].forEach(([a, b]) => x.fillRect(a, b, 2, 2));
  x.fillStyle = "#DDA86E"; [[6, 1], [1, 8], [10, 10]].forEach(([a, b]) => x.fillRect(a, b, 1, 1));
}
function tiles() {
  return {
    D: tileCanvas(dirt),
    G: tileCanvas((x) => {
      dirt(x);
      const g = x.createLinearGradient(0, 0, 0, 6); g.addColorStop(0, "#9BEA5C"); g.addColorStop(1, "#3FAE3A");
      x.fillStyle = g; x.fillRect(0, 0, T, 5); x.fillRect(2, 5, 3, 2); x.fillRect(9, 5, 4, 1);
      x.fillStyle = "rgba(255,255,255,.75)"; x.fillRect(0, 0, T, 1);
    }),
    B: tileCanvas((x) => {
      const g = x.createLinearGradient(0, 0, 0, T); g.addColorStop(0, "rgba(200,245,255,.95)"); g.addColorStop(1, "rgba(40,170,220,.85)");
      x.fillStyle = g; x.fillRect(0, 0, T, T);
      x.fillStyle = "rgba(255,255,255,.7)"; x.fillRect(0, 0, T, 7);
      x.strokeStyle = "rgba(255,255,255,.95)"; x.strokeRect(0.5, 0.5, T - 1, T - 1);
      x.fillStyle = "#fff"; x.fillRect(3, 2, 3, 2);
    }),
    K: tileCanvas((x) => {
      x.fillStyle = "#FF9EC4"; x.fillRect(0, 0, T, T);
      x.fillStyle = "#FFFFFF"; x.fillRect(1, 1, T - 2, T - 2);
      x.beginPath(); x.moveTo(3, 6); x.lineTo(4, 2); x.lineTo(7, 5); x.moveTo(9, 5); x.lineTo(12, 2); x.lineTo(13, 6); x.fillStyle = "#fff"; x.strokeStyle = "#333"; x.lineWidth = 1; x.stroke();
      x.fillStyle = "#222"; x.fillRect(5, 8, 1, 2); x.fillRect(10, 8, 1, 2);
      x.fillStyle = "#F7C948"; x.fillRect(7, 10, 2, 1);
      x.fillStyle = "#222"; x.fillRect(1, 9, 3, 1); x.fillRect(12, 9, 3, 1);
      x.fillStyle = "#E0508A"; x.fillRect(11, 2, 2, 3); x.fillRect(13, 3, 2, 1); x.fillRect(9, 3, 2, 1);
    }),
    U: tileCanvas((x) => {
      x.fillStyle = "#E7D4DF"; x.fillRect(0, 0, T, T); x.fillStyle = "#F7EEF3"; x.fillRect(1, 1, T - 2, T - 2);
      x.fillStyle = "#D4BCCB"; x.fillRect(3, 3, 2, 2); x.fillRect(11, 3, 2, 2); x.fillRect(3, 11, 2, 2); x.fillRect(11, 11, 2, 2);
    }),
  } as Record<string, HTMLCanvasElement>;
}

/* ============ Engine ============ */
export function startShel(canvas: HTMLCanvasElement): ShelApi {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const TILE = tiles();
  const shelFrames = SHEL_LEGS.map((legs) => bitmap([...SHEL_TOP, ...legs], SHEL_PAL));
  const vamp = bitmap(VAMP, VAMP_PAL);

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#0E63C8"); sky.addColorStop(0.45, "#3FA4EE"); sky.addColorStop(0.8, "#BFE6FB"); sky.addColorStop(1, "#E9F8FF");
  const sun = ctx.createRadialGradient(90, 46, 0, 90, 46, 150);
  sun.addColorStop(0, "rgba(255,250,230,.95)"); sun.addColorStop(0.2, "rgba(255,250,230,.4)"); sun.addColorStop(1, "rgba(255,250,230,0)");
  const clouds = Array.from({ length: 9 }, (_, i) => ({ x: i * 170 + (i % 3) * 37, y: 26 + ((i * 53) % 90), s: 0.7 + ((i * 17) % 10) / 14 }));
  const bubbles = Array.from({ length: 26 }, (_, i) => ({ x: (i * 97) % (W + 40), y: (i * 61) % (H + 40), r: 2 + (i % 5) * 1.6, s: 0.25 + (i % 4) * 0.12 }));

  let L = level(), mode: Mode = "title", paused = false, raf = 0, t = 0, camX = 0;
  let shells: Shell[] = [], sparks: Spark[] = [];
  const keys = { left: false, right: false, jump: false };
  let jumpQueued = false;
  const p = { x: 0, y: 0, vx: 0, vy: 0, w: 10, h: 15, onGround: false, jumps: 0, face: 1, inv: 0, lives: 3, score: 0, orbs: 0, safe: { x: 0, y: 0 } };

  function reset() {
    L = level(); shells = []; sparks = [];
    Object.assign(p, { x: L.start.x, y: L.start.y, vx: 0, vy: 0, onGround: false, jumps: 0, face: 1, inv: 0, lives: 3, score: 0, orbs: 0, safe: { ...L.start } });
  }
  reset();

  const tileAt = (cx: number, cy: number) => (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS ? "." : L.g[cy][cx]);
  const solidAt = (px: number, py: number) => SOLID.includes(tileAt(Math.floor(px / T), Math.floor(py / T)));
  const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const burst = (x: number, y: number, col: string, n = 8, heart = false) => {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; sparks.push({ x, y, vx: Math.cos(a) * 1.6, vy: Math.sin(a) * 1.6 - 0.6, life: 30, col, heart }); }
  };

  function hurt() {
    if (p.inv > 0 || mode !== "play") return;
    p.lives--; p.inv = 90; play("hurt");
    if (p.lives <= 0) { mode = "over"; play("lose"); return; }
    p.vy = -4.5; p.vx = -p.face * 2.5;
  }

  function step() {
    t++;
    sparks = sparks.filter((s) => { s.x += s.vx; s.y += s.vy; s.vy += s.heart ? -0.02 : 0.08; return --s.life > 0; });
    L.ghosts.forEach((g) => {
      if (g.dead >= 0) { g.dead++; return; }
      g.t++; g.x += g.dir * 0.6;
      const ahead = g.dir > 0 ? g.x + 15 : g.x;
      if (Math.abs(g.x - g.x0) > 40 || solidAt(ahead, g.y + 8)) g.dir *= -1;
    });
    if (mode !== "play") return;

    const ax = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
    if (ax) { p.vx += ax * 0.45; p.face = ax; } else p.vx *= p.onGround ? 0.72 : 0.94;
    p.vx = Math.max(-2.7, Math.min(2.7, p.vx));
    if (jumpQueued) {
      if (p.onGround) { p.vy = -7.2; p.jumps = 1; play("jump"); }
      else if (p.jumps < 2) { p.vy = -6.4; p.jumps = 2; play("doubleJump"); burst(p.x + 5, p.y + 15, "#BFF4FF", 6); }
    }
    jumpQueued = false;
    if (!keys.jump && p.vy < -3) p.vy = -3; // let go early for a short hop
    p.vy = Math.min(p.vy + 0.42, 7.5);

    // x, then y, each resolved against the tiles it overlaps
    p.x = Math.max(0, Math.min(COLS * T - p.w, p.x + p.vx));
    for (const yy of [p.y + 1, p.y + p.h - 1]) {
      if (p.vx > 0 && solidAt(p.x + p.w, yy)) { p.x = Math.floor((p.x + p.w) / T) * T - p.w - 0.01; p.vx = 0; }
      if (p.vx < 0 && solidAt(p.x, yy)) { p.x = Math.floor(p.x / T) * T + T + 0.01; p.vx = 0; }
    }
    p.y += p.vy; p.onGround = false;
    if (p.vy > 0 && (solidAt(p.x + 1, p.y + p.h) || solidAt(p.x + p.w - 1, p.y + p.h))) {
      p.y = Math.floor((p.y + p.h) / T) * T - p.h; p.vy = 0; p.onGround = true; p.jumps = 0;
      if (solidAt(p.x + 1, p.y + p.h + 1) && solidAt(p.x + p.w - 1, p.y + p.h + 1)) p.safe = { x: p.x, y: p.y };
    } else if (p.vy < 0 && (solidAt(p.x + 1, p.y) || solidAt(p.x + p.w - 1, p.y))) {
      const cy = Math.floor(p.y / T), cx = Math.floor((p.x + p.w / 2) / T);
      for (const c of [cx, cx - 1, cx + 1]) {
        if (tileAt(c, cy) !== "K") continue;
        L.g[cy][c] = "U"; shells.push({ x: c * T + 2, y: cy * T, ty: cy * T - 14, taken: false }); play("coin"); break;
      }
      p.y = (cy + 1) * T; p.vy = 0;
    }
    if (p.y > H + 24) { hurt(); if (mode === "play") { p.x = p.safe.x; p.y = p.safe.y - 4; p.vx = p.vy = 0; } }
    if (p.inv > 0) p.inv--;

    const box = { x: p.x, y: p.y, w: p.w, h: p.h };
    L.orbs.forEach((o) => {
      if (o.taken || !hit(box, { x: o.x, y: o.y, w: 10, h: 10 })) return;
      o.taken = true; p.orbs++; p.score += 50; play("coin"); burst(o.x + 5, o.y + 5, "#7FE8FF");
    });
    shells.forEach((s) => {
      if (s.y > s.ty) s.y -= 0.8;
      if (s.taken || !hit(box, { x: s.x, y: s.y, w: 12, h: 10 })) return;
      s.taken = true; p.lives = Math.min(MAX_LIVES, p.lives + 1); p.score += 100; play("heal"); burst(s.x + 6, s.y + 5, "#FF7FB0", 7, true);
    });
    L.ghosts.forEach((g) => {
      if (g.dead >= 0) return;
      const gy = g.y + Math.sin(g.t * 0.06) * 3, gb = { x: g.x + 2, y: gy + 2, w: 12, h: 12 };
      if (!hit(box, gb)) return;
      if (p.vy > 0.5 && p.y + p.h - gb.y < 9) { g.dead = 0; p.vy = -5.2; p.jumps = 1; p.score += 100; play("stomp"); burst(g.x + 8, gy + 8, "#FFFFFF", 10); }
      else hurt();
    });
    if (hit(box, L.goal)) { mode = "win"; p.score += p.lives * 200; play("win"); for (let i = 0; i < 4; i++) burst(L.goal.x + 6, L.goal.y + 6, "#FF5C93", 8, true); }
    camX = Math.max(0, Math.min(COLS * T - W, p.x - W * 0.42));
  }

  /* ---------- drawing ---------- */
  const R = Math.round;
  function cloud(x: number, y: number, s: number) {
    ctx.fillStyle = "rgba(255,255,255,.88)";
    [[0, 6, 14], [14, 0, 18], [32, 5, 15], [18, 10, 14]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); ctx.fill(); });
  }
  function dome(x: number) {
    const base = H - 52;
    ctx.fillStyle = "rgba(120,200,120,.55)"; ctx.beginPath(); ctx.ellipse(x, base + 6, 150, 18, 0, 0, Math.PI * 2); ctx.fill();
    [[-70, 70, 16], [-40, 104, 18], [-12, 128, 14], [14, 92, 20], [44, 112, 15], [72, 66, 16]].forEach(([dx, h, w]) => {
      const g = ctx.createLinearGradient(0, base - h, 0, base); g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(1, "rgba(160,220,240,.9)");
      ctx.fillStyle = g; ctx.fillRect(x + dx - w / 2, base - h, w, h);
      ctx.fillStyle = "rgba(60,160,210,.45)"; for (let wy = base - h + 6; wy < base - 6; wy += 9) ctx.fillRect(x + dx - w / 2 + 3, wy, w - 6, 3);
      ctx.fillStyle = "#4CC35A"; ctx.beginPath(); ctx.arc(x + dx, base - h - 2, w * 0.45, 0, Math.PI * 2); ctx.fill();
    });
    ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, base, 120, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = "rgba(190,240,255,.18)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, base, 108, Math.PI * 1.15, Math.PI * 1.45); ctx.stroke();
  }
  function ghost(x: number, y: number, alpha = 0.85) {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(x + 8, y + 7, 7, Math.PI, 0); ctx.lineTo(x + 15, y + 15);
    for (let i = 0; i < 4; i++) ctx.lineTo(x + 15 - i * 3.5 - 1.75, y + (i % 2 ? 15 : 12) + Math.sin(t * 0.2 + i) * 1);
    ctx.lineTo(x + 1, y + 15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#1460C8"; ctx.fillRect(x + 5, y + 6, 2, 3); ctx.fillRect(x + 10, y + 6, 2, 3);
    ctx.fillStyle = "#FF9EC4"; ctx.fillRect(x + 3, y + 10, 2, 1); ctx.fillRect(x + 12, y + 10, 2, 1);
    ctx.restore();
  }
  function shell(x: number, y: number) {
    ctx.fillStyle = "#FF8AB8"; ctx.beginPath(); ctx.moveTo(x + 6, y + 10); ctx.arc(x + 6, y + 9, 7, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#E0508A"; ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + 6, y + 10); ctx.lineTo(x + 6 + i * 2.6, y + 3 + Math.abs(i)); ctx.stroke(); }
    ctx.fillStyle = "#FFD1E3"; ctx.fillRect(x + 4, y + 9, 5, 2);
  }
  function heart(x: number, y: number, col: string, s = 1) {
    ctx.fillStyle = col;
    [[1, 0, 2, 1], [5, 0, 2, 1], [0, 1, 8, 3], [1, 4, 6, 1], [2, 5, 4, 1], [3, 6, 2, 1]].forEach(([a, b, w, h]) => ctx.fillRect(x + a * s, y + b * s, w * s, h * s));
  }
  function text(s: string, x: number, y: number, size = 10, align: CanvasTextAlign = "left", col = "#fff") {
    ctx.font = `bold ${size}px ui-monospace, Menlo, monospace`; ctx.textAlign = align; ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(11,42,74,.75)"; ctx.fillText(s, x + 1, y + 1); ctx.fillStyle = col; ctx.fillText(s, x, y);
  }
  function panel(lines: [string, number, string?][]) {
    const h = lines.length * 22 + 26;
    const g = ctx.createLinearGradient(0, H / 2 - h / 2, 0, H / 2 + h / 2);
    g.addColorStop(0, "rgba(76,178,255,.92)"); g.addColorStop(0.5, "rgba(30,139,224,.92)"); g.addColorStop(1, "rgba(20,96,200,.94)");
    ctx.fillStyle = g; ctx.fillRect(W / 2 - 190, H / 2 - h / 2, 380, h);
    ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.fillRect(W / 2 - 190, H / 2 - h / 2, 380, h / 2.4);
    ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 2; ctx.strokeRect(W / 2 - 189, H / 2 - h / 2 + 1, 378, h - 2);
    lines.forEach(([s, size, col], i) => text(s, W / 2, H / 2 - h / 2 + 16 + i * 22, size, "center", col ?? "#fff"));
  }

  function draw() {
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-20, 120); ctx.quadraticCurveTo(W / 2, 70, W + 20, 110); ctx.stroke();
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-20, 132); ctx.quadraticCurveTo(W / 2, 86, W + 20, 124); ctx.stroke();
    for (let i = 0; i < 2; i++) dome(((i * 560 - camX * 0.15) % 1120 + 1120) % 1120 - 160);
    clouds.forEach((c) => cloud(((c.x - camX * 0.3 - t * 0.08) % (W + 160) + W + 160) % (W + 160) - 80, c.y, c.s));
    ctx.fillStyle = "rgba(90,190,110,.45)";
    for (let i = 0; i < 4; i++) { const hx = ((i * 260 - camX * 0.5) % 1040 + 1040) % 1040 - 200; ctx.beginPath(); ctx.ellipse(hx, H - 20, 170, 60, 0, Math.PI, 0); ctx.fill(); }
    bubbles.forEach((b) => {
      const x = ((b.x - camX * 0.5) % (W + 40) + W + 40) % (W + 40) - 20, y = ((b.y - t * b.s) % (H + 40) + H + 40) % (H + 40) - 20;
      ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, b.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(R(x - b.r * 0.45), R(y - b.r * 0.5), 1, 1);
    });

    const cx = Math.floor(camX), c0 = Math.floor(cx / T), c1 = Math.min(COLS - 1, c0 + W / T + 1);
    for (let r = 0; r < ROWS; r++) for (let c = c0; c <= c1; c++) { const k = L.g[r][c]; if (TILE[k]) ctx.drawImage(TILE[k], c * T - cx, r * T); }

    L.orbs.forEach((o) => {
      if (o.taken) return;
      const ox = o.x - cx, oy = o.y + Math.sin(t * 0.08 + o.x) * 2;
      const g = ctx.createRadialGradient(ox + 3, oy + 3, 0, ox + 5, oy + 5, 6);
      g.addColorStop(0, "#FFFFFF"); g.addColorStop(0.35, "#7FE8FF"); g.addColorStop(1, "#1E8BE0");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ox + 5, oy + 5, 5, 0, Math.PI * 2); ctx.fill();
    });
    shells.forEach((s) => { if (!s.taken) shell(R(s.x - cx), R(s.y)); });
    L.ghosts.forEach((g) => {
      if (g.dead > 20) return;
      ghost(R(g.x - cx), R(g.y + Math.sin(g.t * 0.06) * 3 - (g.dead >= 0 ? g.dead : 0)), g.dead >= 0 ? 0.85 * (1 - g.dead / 20) : 0.85);
    });

    // the goal: the vampire boyfriend on his dais, with a floating heart
    ctx.save(); ctx.translate(L.goal.x - cx, L.goal.y); ctx.scale(-1, 1); ctx.drawImage(vamp, -12, 0); ctx.restore();
    heart(L.goal.x - cx + 2, L.goal.y - 12 + Math.sin(t * 0.08) * 2, "#FF5C93");

    if (!(p.inv > 0 && Math.floor(t / 4) % 2)) {
      const f = !p.onGround ? 2 : Math.abs(p.vx) > 0.3 ? Math.floor(t / 6) % 2 : 0;
      ctx.save(); ctx.translate(R(p.x - cx) - 1 + (p.face < 0 ? 12 : 0), R(p.y) - 1); ctx.scale(p.face < 0 ? -1 : 1, 1);
      ctx.drawImage(shelFrames[f], 0, 0); ctx.restore();
    }
    sparks.forEach((s) => {
      ctx.globalAlpha = Math.min(1, s.life / 15);
      if (s.heart) heart(R(s.x - cx), R(s.y), s.col); else { ctx.fillStyle = s.col; ctx.fillRect(R(s.x - cx), R(s.y), 2, 2); }
      ctx.globalAlpha = 1;
    });

    for (let i = 0; i < MAX_LIVES; i++) heart(10 + i * 14, 10, i < p.lives ? "#FF5C93" : "rgba(255,255,255,.45)", 1.25);
    text(`SCORE ${String(p.score).padStart(5, "0")}`, W / 2, 9, 11, "center");
    text(`ORBS ${p.orbs}/10`, W - 10, 9, 11, "right");

    if (mode === "title") panel([["SHEL", 26, "#FFFFFF"], ["in Frutiger Aero", 11, "#E6FBFF"], ["← → move · Space jump · twice to double jump", 10], ["Space or tap to start", 11, "#FFF3A8"]]);
    else if (mode === "over") panel([["GAME OVER", 20], [`score ${p.score} · orbs ${p.orbs}/10`, 11], ["Space or tap to try again", 11, "#FFF3A8"]]);
    else if (mode === "win") panel([["YOU FOUND HIM ♥", 20, "#FFE0EC"], [`score ${p.score} · orbs ${p.orbs}/10`, 11], [p.orbs === 10 ? "every orb! a perfect run" : "Space or tap to play again", 11, "#FFF3A8"]]);
    else if (paused) panel([["PAUSED", 20], ["P to resume", 11]]);
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    acc += Math.min(100, now - last); last = now;
    while (acc >= STEP) { if (!paused) step(); acc -= STEP; }
    draw();
  }
  let last = performance.now(), acc = 0;
  raf = requestAnimationFrame(frame);

  function begin() { reset(); mode = "play"; play("coin"); }
  function press(k: ShelKey, down: boolean) {
    if (k === "jump") {
      if (down && !keys.jump) { if (mode === "play") jumpQueued = true; else begin(); }
      keys.jump = down;
    } else keys[k] = down;
  }
  const KEYS: Record<string, ShelKey> = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", Space: "jump", ArrowUp: "jump", KeyW: "jump", KeyZ: "jump" };
  const onDown = (e: KeyboardEvent) => {
    const k = KEYS[e.code];
    if (k) { e.preventDefault(); if (!e.repeat) press(k, true); return; }
    if (e.code === "KeyR") begin();
    if (e.code === "KeyP" && mode === "play") paused = !paused;
  };
  const onUp = (e: KeyboardEvent) => { const k = KEYS[e.code]; if (k) { e.preventDefault(); press(k, false); } };
  const onTap = () => { if (mode !== "play") begin(); };
  addEventListener("keydown", onDown); addEventListener("keyup", onUp);
  canvas.addEventListener("pointerdown", onTap);

  return {
    press,
    restart: begin,
    setPaused: (v) => { paused = v; },
    destroy() {
      cancelAnimationFrame(raf);
      removeEventListener("keydown", onDown); removeEventListener("keyup", onUp);
      canvas.removeEventListener("pointerdown", onTap);
    },
  };
}
