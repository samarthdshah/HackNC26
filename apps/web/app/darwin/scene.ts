// Darwin Growth scene, ported from the v6 page script: a canvas tree that grows one ring of
// branches per generation, with fruit ripening on the canopy. Two modes:
//   live      (agent GET /darwin): each fruit is one generation's best rule set. Approve and it
//             glows gold (the agent routes by its rules); reject and it falls to the island.
//             Mechanism from CodeRockerr's version7 darwin.html.
//   snapshot  (lib/wf/darwin.ts): each fruit is an evolved rule; Approve/Reject are disabled.

import type { DarwinGeneration, WfGeneration, WfRule } from "@wayfinder/shared";
import { RM, hex, onTheme, palette } from "@/lib/aero/runtime";

export type Action = "approve" | "reject";
export interface DarwinCtx {
  gens: WfGeneration[]; // the rings shown (already sampled to at most MAX_RINGS)
  totalGens: number; // generations in the run, for the footnote
  rules: WfRule[];
  replayed: number | null;
  /** Live mode: every generation is a fruit, and decide() saves a decision (throws when it wasn't saved). */
  live?: { generations: DarwinGeneration[]; decide: (gen: number, action: Action) => Promise<void> };
}

type Status = WfRule["status"];
/** What a fruit stands for: one rule (snapshot) or one generation (live). */
interface Item { status: Status; order: number; rule?: WfRule; gen?: DarwinGeneration }

/** A binary tree doubles per ring, so long runs show their milestones: Gen 0, every improvement, the last. */
export const MAX_RINGS = 10;
export function sampleGenerations(all: WfGeneration[], max = MAX_RINGS): WfGeneration[] {
  if (all.length <= max) return all;
  const keep = new Set<number>([0, all.length - 1]);
  for (let i = 1; i < all.length && keep.size < max; i++) if (all[i].fitness !== all[i - 1].fitness || all[i].rules !== all[i - 1].rules) keep.add(i);
  for (let k = 1; keep.size < max && k < max; k++) keep.add(Math.round((k * (all.length - 1)) / (max - 1)));
  for (let i = 0; keep.size < max && i < all.length; i++) keep.add(i);
  return [...keep].sort((a, b) => a - b).slice(0, max).map((i) => all[i]);
}

/* ============ Small helpers ============ */
type C3 = number[];
const rgb = (n: number): C3 => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const mix = (a: C3, b: C3, t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = (c: C3, a = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;
const lighten = (c: C3, t: number) => mix(c, [255, 255, 255], t), darken = (c: C3, t: number) => mix(c, [0, 20, 50], t);
function mulberry(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const backOut = (t: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const FROZEN_A = 0.55; // left for live learning: a paler fruit

interface Branch { angle: number; angleInc: number; distance: number; distanceFade: number; generation: number; growthSpeed: number; hadBranches: boolean; progress: number; x1: number; y1: number; x2: number; y2: number }
interface Fall { vx: number; vy: number; landY: number; landed: boolean; grey: number; bounces: number }
interface Fruit {
  progress: number; speed: number; x: number; y: number; r: number; tone: number; item?: Item; rp: number; delay: number;
  ox: number; oy: number; fall?: Fall | null; rise?: { fromX: number; fromY: number; t: number } | null; pulse?: number;
}

/* ============ Tree: the pasted canvas tree, grown once ============ */
class Tree {
  C: HTMLCanvasElement; c: CanvasRenderingContext2D;
  W = 800; H = 800; floorY = 685; S = 1;
  maxGenerations: number; items: Item[];
  hover: Fruit | null = null; raf = 0; fx = 0;
  rand = Math.random; branches: Branch[] = []; fruit: Fruit[] = []; ruleFruit: Fruit[] = [];
  genDone: number[] = []; genComplete = 0; done = false;
  onGeneration: (n: number) => void = () => {};
  onSettled: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, gens: number, items: Item[]) {
    this.C = canvas; this.c = canvas.getContext("2d")!;
    this.maxGenerations = Math.max(1, gens); this.items = items;
    this.setupCanvas();
  }
  setupCanvas() {
    const S = this.S = Math.min(devicePixelRatio || 1, 2);
    this.C.width = this.W * S; this.C.height = this.H * S;
    const st = this.C.parentElement!.getBoundingClientRect(), side = Math.max(200, Math.min(st.width, st.height));
    this.C.style.width = this.C.style.height = side + "px";
    this.c.setTransform(S, 0, 0, S, 0, 0); this.c.lineCap = "round"; this.c.lineJoin = "round";
  }
  get trunk(): Branch {
    return { angle: 0, angleInc: 20, distance: 120, distanceFade: 0.2, generation: 1, growthSpeed: 0.035, hadBranches: false, progress: 0, x1: 400, y1: 680, x2: 400, y2: 560 };
  }
  reset(seed: number) {
    this.rand = mulberry(seed); this.branches = [this.trunk]; this.fruit = [];
    this.genDone = new Array(this.maxGenerations + 1).fill(0); this.genComplete = 0;
    this.ruleFruit = []; this.done = false; this.hover = null;
  }
  randomInt(min: number, max: number) { return min + Math.round(this.rand() * (max - min)); }
  grow() {
    const { branches, maxGenerations } = this;
    branches.forEach((b) => { // forEach skips branches pushed this frame, as in the original
      if (b.progress < 1) {
        b.progress = Math.min(1, b.progress + b.growthSpeed);
        if (b.progress === 1) {
          if (++this.genDone[b.generation] === 2 ** (b.generation - 1)) this.onGeneration(b.generation);
          if (b.generation === maxGenerations) this.fruit.push({ progress: 0, speed: 0.04 + this.rand() * 0.03, x: b.x2, y: b.y2, ox: b.x2, oy: b.y2, r: this.randomInt(3, 5), tone: this.randomInt(0, 2), rp: 0, delay: 0 });
        }
      } else if (!b.hadBranches && b.generation < maxGenerations) {
        b.hadBranches = true;
        const lean = 5, distance = b.distance * (1 - b.distanceFade), generation = b.generation + 1;
        for (const side of [-1, 1]) {
          const angle = b.angle + side * (b.angleInc + this.randomInt(-lean, lean));
          branches.push({ ...b, angle, distance, generation, hadBranches: false, progress: 0, x1: b.x2, y1: b.y2,
            x2: b.x2 + Math.sin((angle * Math.PI) / 180) * distance, y2: b.y2 - Math.cos((angle * Math.PI) / 180) * distance });
        }
      }
    });
    this.fruit.forEach((f) => { if (f.progress < 1) f.progress = Math.min(1, f.progress + f.speed); });
    this.ruleFruit.forEach((f) => { if (f.delay > 0) f.delay--; else if (f.rp < 1) f.rp = Math.min(1, f.rp + 0.05); });
    const allFruit = this.fruit.length === 2 ** (maxGenerations - 1) && this.fruit.every((f) => f.progress === 1);
    if (allFruit && !this.ruleFruit.length && this.items.length) this.pickRules();
    if (allFruit && this.ruleFruit.every((f) => f.rp === 1)) { this.done = true; this.onSettled(); }
  }
  pickRules() { // spread the items evenly around the canopy (left to right in order), ripening in that order
    const ITEMS = this.items;
    const cx = 400, cy = 470, byAngle = [...this.fruit].sort((a, b) => Math.atan2(a.x - cx, cy - a.y) - Math.atan2(b.x - cx, cy - b.y));
    const n = ITEMS.length, picks = ITEMS.map((_, i) => byAngle[Math.floor(((i + 0.5) * byAngle.length) / n)]);
    const order = ITEMS.map((_, i) => i).sort((a, b) => ITEMS[a].order - ITEMS[b].order);
    picks.forEach((f, i) => {
      f.item = ITEMS[i]; f.rp = 0; f.delay = order.indexOf(i) * 7; f.ox = f.x; f.oy = f.y; f.fall = null; f.rise = null; f.pulse = undefined;
      if (f.item.status === "rejected") this.restOnGround(f); // already rejected: it lies on the island
    });
    this.ruleFruit = picks;
  }
  /* ---- fruit states: approved fruit glow, rejected fruit fall to the island ---- */
  groundY(x: number, r: number) { const dx = Math.min(1, Math.abs(x - 400) / 280); return this.floorY + 2 - 20 * Math.sqrt(1 - dx * dx) + 3 - r; }
  restOnGround(f: Fruit) { f.x = Math.max(150, Math.min(650, f.ox)); f.y = this.groundY(f.x, 8.5); f.fall = { vx: 0, vy: 0, landY: f.y, landed: true, grey: 1, bounces: 0 }; }
  drop(f: Fruit) { // gravity from the branch to the island, a small bounce, then rest
    const tx = Math.max(150, Math.min(650, f.ox)), landY = this.groundY(tx, 8.5), frames = Math.sqrt((2 * Math.max(20, landY - f.y)) / 0.45);
    f.rise = null; f.fall = { vx: (tx - f.x) / frames, vy: -1.6, landY, landed: false, grey: 0, bounces: 0 };
  }
  lift(f: Fruit) { f.fall = null; f.rise = { fromX: f.x, fromY: f.y, t: 0 }; f.pulse = 0; }
  glow(f: Fruit) { f.pulse = 0; }
  animating() { return this.ruleFruit.some((f) => (f.fall && !f.fall.landed) || f.rise || (f.pulse !== undefined && f.pulse < 1)); }
  stepFruit() {
    for (const f of this.ruleFruit) {
      const fl = f.fall;
      if (fl && !fl.landed) {
        fl.vy += 0.45; f.x += fl.vx; f.y += fl.vy; fl.grey = Math.min(1, fl.grey + 0.04);
        if (f.y >= fl.landY) {
          f.y = fl.landY;
          if (Math.abs(fl.vy) > 2.2 && fl.bounces < 2) { fl.vy = -fl.vy * 0.32; fl.vx *= 0.5; fl.bounces++; }
          else { fl.landed = true; fl.grey = 1; }
        }
      }
      if (f.rise) {
        const r = f.rise; r.t = Math.min(1, r.t + 0.035); const e = backOut(r.t);
        f.x = r.fromX + (f.ox - r.fromX) * e; f.y = r.fromY + (f.oy - r.fromY) * e;
        if (r.t === 1) { f.x = f.ox; f.y = f.oy; f.rise = null; }
      }
      if (f.pulse !== undefined && f.pulse < 1) f.pulse = Math.min(1, f.pulse + 0.022);
    }
  }
  animate() { // runs only while a fruit is falling, rising or pulsing, after the tree has settled
    if (this.fx || this.raf) return;
    if (RM) { let guard = 0; while (this.animating() && guard++ < 2000) this.stepFruit(); this.draw(); return; }
    const tick = () => { this.stepFruit(); this.draw(); this.fx = this.animating() ? requestAnimationFrame(tick) : 0; };
    this.fx = requestAnimationFrame(tick);
  }
  finishInstantly() { // reduced motion: the finished tree, no growth
    let guard = 0; while (!this.done && guard++ < 5000) this.grow(); // same steps as the animation, just not drawn
  }
  colors() {
    const p = palette();
    return { lo: darken(rgb(p.hub), 0.25), mid: rgb(p.accent), tip: rgb(p.levels[3]), fruit: [rgb(p.levels[1]), rgb(p.levels[2]), rgb(p.levels[4])], rule: rgb(p.person), ground: rgb(p.levels[3]), groundLo: rgb(p.hub) };
  }
  branchColor(g: number, k: ReturnType<Tree["colors"]>) {
    const t = this.maxGenerations > 1 ? (g - 1) / (this.maxGenerations - 1) : 0;
    return t < 0.5 ? mix(k.lo, k.mid, t * 2) : mix(k.mid, k.tip, (t - 0.5) * 2);
  }
  orb(x: number, y: number, r: number, col: C3, a = 1) {
    const c = this.c, g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
    g.addColorStop(0, css(lighten(col, 0.75), a)); g.addColorStop(0.45, css(col, a)); g.addColorStop(1, css(darken(col, 0.35), a));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = `rgb(255 255 255 / ${0.85 * a})`; c.beginPath(); c.ellipse(x - r * 0.3, y - r * 0.45, r * 0.42, r * 0.24, -0.5, 0, Math.PI * 2); c.fill();
  }
  draw() {
    const { c, W, H, floorY } = this, k = this.colors();
    c.clearRect(0, 0, W, H);
    // glossy island the tree grows from, with a soft reflection on the water line
    const gx = 400, gy = floorY + 2;
    let g = c.createLinearGradient(0, gy - 22, 0, gy + 22);
    g.addColorStop(0, css(lighten(k.ground, 0.45))); g.addColorStop(0.5, css(k.ground)); g.addColorStop(1, css(mix(k.ground, k.groundLo, 0.6)));
    c.fillStyle = g; c.beginPath(); c.ellipse(gx, gy, 280, 20, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgb(255 255 255 / .45)"; c.beginPath(); c.ellipse(gx - 40, gy - 9, 190, 5, 0, 0, Math.PI * 2); c.fill();
    g = c.createLinearGradient(0, gy + 18, 0, gy + 70); g.addColorStop(0, "rgb(255 255 255 / .35)"); g.addColorStop(1, "rgb(255 255 255 / 0)");
    c.fillStyle = g; c.beginPath(); c.ellipse(gx, gy + 34, 360, 26, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgb(255 255 255 / .55)"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(60, gy + 24); c.lineTo(740, gy + 24); c.stroke();

    // branches, one batch per generation: tapering width, gradient from deep trunk to fresh tips, gloss on the thick ones
    const byGen: Branch[][] = [];
    for (const b of this.branches) if (b.progress > 0) (byGen[b.generation] ||= []).push(b);
    byGen.forEach((list, gen) => {
      if (!list) return;
      const w = Math.max(1.3, 12 * Math.pow(0.8, gen - 1)), col = this.branchColor(gen, k);
      c.strokeStyle = css(col); c.lineWidth = w; c.beginPath();
      for (const b of list) { c.moveTo(b.x1, b.y1); c.lineTo(b.x1 + (b.x2 - b.x1) * b.progress, b.y1 + (b.y2 - b.y1) * b.progress); }
      c.stroke();
      if (gen <= 6) {
        c.strokeStyle = `rgb(255 255 255 / ${0.42 - gen * 0.04})`; c.lineWidth = w * 0.3; c.beginPath();
        const o = w * 0.22;
        for (const b of list) { c.moveTo(b.x1 - o, b.y1); c.lineTo(b.x1 - o + (b.x2 - b.x1) * b.progress, b.y1 + (b.y2 - b.y1) * b.progress); }
        c.stroke();
      }
    });

    // decorative fruit
    for (const f of this.fruit) if (!f.item && f.progress > 0) this.orb(f.x, f.y, f.r * backOut(f.progress), k.fruit[f.tone], 0.92);
    // item fruit: bigger, theme "person" color. Approved: gold with a sunlit halo (pulses when approved).
    // Rejected: greys as it falls and lies on the island. Frozen (left for live learning): pale.
    const grey: C3 = [157, 176, 195], gold: C3 = [255, 214, 102];
    for (const f of this.ruleFruit) {
      if (f.rp <= 0 && !f.fall) { this.orb(f.x, f.y, f.r, k.fruit[f.tone], 0.92); continue; }
      const st = f.item!.status, approved = st === "approved" && !f.fall, p = f.pulse ?? 1;
      const grow = approved ? 1.4 + 0.4 * Math.sin(Math.min(1, p) * Math.PI) : 1;
      const r = 8.5 * (f.fall ? 1 : backOut(Math.max(f.rp, 0))) * grow;
      const col = f.fall ? mix(k.rule, grey, f.fall.grey) : st === "rejected" ? grey : approved ? lighten(mix(k.rule, gold, 0.65), 0.28) : k.rule;
      if (approved) { // soft sunlit halo; a ring ripples outward right after approval
        const h = c.createRadialGradient(f.x, f.y, r * 0.5, f.x, f.y, r * 4.6);
        h.addColorStop(0, "rgb(255 253 235 / 1)"); h.addColorStop(0.3, "rgb(255 228 130 / .75)"); h.addColorStop(0.65, "rgb(255 214 102 / .28)"); h.addColorStop(1, "rgb(255 214 102 / 0)");
        c.fillStyle = h; c.beginPath(); c.arc(f.x, f.y, r * 4.6, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "rgb(255 255 240 / .9)"; c.lineWidth = 1.4; c.beginPath(); // four sparkle rays
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i * Math.PI) / 2, r0 = r + 4, r1 = r + 9 + 4 * Math.sin(Math.min(1, p) * Math.PI);
          c.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0); c.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1);
        }
        c.stroke();
        if (p < 1) { c.strokeStyle = `rgb(255 255 255 / ${0.9 * (1 - p)})`; c.lineWidth = 2; c.beginPath(); c.arc(f.x, f.y, r + 4 + p * 26, 0, Math.PI * 2); c.stroke(); }
      }
      if (f === this.hover) { c.fillStyle = "rgb(255 255 255 / .55)"; c.beginPath(); c.arc(f.x, f.y, r + 7, 0, Math.PI * 2); c.fill(); }
      if (f.fall?.landed) { c.fillStyle = "rgb(0 30 60 / .18)"; c.beginPath(); c.ellipse(f.x, f.y + r - 1, r * 1.1, r * 0.35, 0, 0, Math.PI * 2); c.fill(); }
      this.orb(f.x, f.y, r, col, st === "frozen" ? FROZEN_A : 1);
      if (approved) { c.strokeStyle = "rgb(255 255 255 / .95)"; c.lineWidth = 1.8; c.beginPath(); c.arc(f.x, f.y, r + 2.4, 0, Math.PI * 2); c.stroke(); }
      if (st === "frozen") { c.setLineDash([2.5, 2.5]); c.strokeStyle = "rgb(255 255 255 / .9)"; c.lineWidth = 1.3; c.beginPath(); c.arc(f.x, f.y, r + 2.2, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
    }
  }
  loop = () => {
    this.grow(); this.draw();
    if (!this.done) this.raf = requestAnimationFrame(this.loop); else this.raf = 0;
  };
  start(seed: number) {
    cancelAnimationFrame(this.raf); this.raf = 0; cancelAnimationFrame(this.fx); this.fx = 0; this.reset(seed);
    if (RM) { this.finishInstantly(); this.draw(); return; }
    this.raf = requestAnimationFrame(this.loop);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; cancelAnimationFrame(this.fx); this.fx = 0; }
  toLogical(e: PointerEvent | MouseEvent) { const r = this.C.getBoundingClientRect(); return { x: ((e.clientX - r.left) * this.W) / r.width, y: ((e.clientY - r.top) * this.H) / r.height }; }
  toClient(x: number, y: number) { const r = this.C.getBoundingClientRect(); return { x: r.left + (x * r.width) / this.W, y: r.top + (y * r.height) / this.H }; }
  ruleAt(e: PointerEvent | MouseEvent) {
    const p = this.toLogical(e); let best: Fruit | null = null, bd = 14;
    for (const f of this.ruleFruit) { if (f.rp < 1 && !f.fall) continue; const d = Math.hypot(f.x - p.x, f.y - p.y); if (d < bd) { bd = d; best = f; } }
    return best;
  }
}

export interface Scene {
  destroy: () => void;
  /** Live mode: fresh statuses from GET /darwin (another tab, a text, or our own save). Fruit fall or rise to match. */
  apply: (gens: DarwinGeneration[]) => void;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const ROW_TITLE = { proposed: "Proposed: click to approve or reject", approved: "Approved: the agent routes by these rules", rejected: "Rejected: fell from the tree", frozen: "" };

/** Mounts the scene on the page's static markup. */
export function mount(root: HTMLElement, ctx: DarwinCtx): Scene {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const RINGS = ctx.gens, LIVE = ctx.live;
  const ITEMS: Item[] = LIVE
    ? LIVE.generations.map((g) => ({ status: g.status, order: g.gen, gen: { ...g } }))
    : ctx.rules.map((r) => ({ status: r.status, order: r.status === "frozen" ? 1e3 : r.gen, rule: { ...r } }));
  const offs: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, ev: K | string, fn: (e: any) => void) => { el.addEventListener(ev, fn); offs.push(() => el.removeEventListener(ev, fn)); };
  const timers = new Set<ReturnType<typeof setTimeout>>();

  /* ============ Generations card: the rings (snapshot) or every generation (live) ============ */
  const box = $("genRows");
  box.classList.toggle("scroll", Boolean(LIVE));
  const ROWS: WfGeneration[] = LIVE ? LIVE.generations : RINGS;
  box.innerHTML = ROWS.map((g, i) => {
    const st = LIVE ? ITEMS[i].status : "";
    return `<div class="row gen ${st}" data-gen="${g.gen}"${LIVE ? ` title="${esc(ROW_TITLE[st as Status])}"` : ""}><span class="orb sm"></span><span class="nm">Gen ${g.gen}</span>
  <span class="fit" title="Fitness ${g.fitness}"><i style="--w:${Math.round(g.fitness * 100)}%"></i></span><span class="hp">${g.avgHops.toFixed(2)} hops</span><span class="chip info">${g.rules}</span></div>`;
  }).join("");
  const rows = [...root.querySelectorAll<HTMLElement>(".gen")];
  const paintRows = () => { if (LIVE) rows.forEach((r, i) => { r.classList.remove("approved", "rejected", "proposed"); r.classList.add(ITEMS[i].status); r.title = ROW_TITLE[ITEMS[i].status]; }); };
  const tally = () => {
    const a = ITEMS.filter((g) => g.status === "approved").length, r = ITEMS.filter((g) => g.status === "rejected").length;
    return `${plural(ITEMS.length, "generation")} · ${a} approved · ${r} fell`;
  };
  const replayed = ctx.replayed ? `${ctx.replayed.toLocaleString()} ` : "";
  const seeding = ctx.replayed ? `Seeding from ${ctx.replayed.toLocaleString()} resolved requests` : "Seeding from past requests";
  function setGen(n: number) {
    const g = RINGS[n - 1], el = $("genN");
    rows.forEach((r, i) => {
      const done = LIVE ? Boolean(g) && ROWS[i].gen <= g.gen : i < n, now = LIVE ? Boolean(g) && ROWS[i].gen === g.gen : i === n - 1;
      r.classList.toggle("done", done); r.classList.toggle("on", now);
      if (now && LIVE) box.scrollTop = r.offsetTop - box.clientHeight / 2 + r.offsetHeight / 2;
    });
    if (!g) { el.textContent = "Gen 0"; $("genH").textContent = "–"; $("genFrom").textContent = seeding; $("ruleCount").textContent = "0 rules"; return; }
    el.textContent = `Gen ${g.gen}`; $("genH").textContent = g.avgHops.toFixed(2);
    $("genFrom").textContent = n === 1
      ? (LIVE ? `Replaying ${replayed}past requests` : "Replaying the old routes")
      : `${LIVE ? "" : "projected · "}down from ${RINGS[0].avgHops.toFixed(2)} at Gen ${RINGS[0].gen} · fitness ${g.fitness.toFixed(2)}`;
    $("ruleCount").textContent = plural(g.rules, "rule");
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    const t = setTimeout(() => { timers.delete(t); el.classList.remove("bump"); }, 450); timers.add(t);
  }
  function setLive(evolving: boolean) { $("liveTxt").textContent = evolving ? "evolving" : "settled"; $("liveDot").style.background = evolving ? "#FFC24D" : ""; $("liveDot").style.boxShadow = evolving ? "0 0 8px #FFC24D" : ""; }

  /* ============ Wire up ============ */
  const canvas = $<HTMLCanvasElement>("tree");
  const tree = new Tree(canvas, RINGS.length, ITEMS);
  tree.onGeneration = (n) => { tree.genComplete = n; setGen(n); };
  const settledCount = () => {
    if (LIVE) return tally();
    const last = RINGS.at(-1), live = ITEMS.filter((r) => r.status !== "frozen").length;
    return `${last?.rules ?? live} rules · ${ITEMS.length} on the tree`;
  };
  tree.onSettled = () => { setLive(false); $("ruleCount").textContent = settledCount(); };
  on(window, "resize", () => { tree.setupCanvas(); tree.draw(); });
  let seed = 7;
  function grow() { closeRule(); hideTip(); setGen(0); setLive(true); tree.start(seed++); }

  const tip = $("tip");
  function hideTip() { tip.classList.add("off"); canvas.classList.remove("hit"); }
  function statusChip(s: Status): [string, string] {
    if (LIVE) return s === "approved" ? ["chip", "Approved · agent routes by it"] : s === "rejected" ? ["chip bad", "Rejected · fell from the tree"] : ["chip warn", "Proposed · needs admin"];
    return s === "approved" ? ["chip", "Approved"] : s === "rejected" ? ["chip bad", "Rejected"] : s === "frozen" ? ["chip info", "Left for live learning"] : ["chip warn", "Proposed · needs admin"];
  }
  const tipText = (it: Item) => it.gen
    ? `Gen ${it.gen.gen} · ${it.gen.avgHops.toFixed(2)} hops · ${plural(it.gen.rules, "rule")}`
    : `${it.status === "frozen" ? "Live learning" : `Gen ${it.rule!.gen}`} · ${it.rule!.text}`;
  on(canvas, "pointermove", (e: PointerEvent) => {
    if (!tree.done) return;
    const f = tree.ruleAt(e);
    if (f !== tree.hover) { tree.hover = f; tree.draw(); }
    if (!f) return hideTip();
    const p = tree.toClient(f.x, f.y), it = f.item!;
    tip.style.left = p.x + "px"; tip.style.top = p.y + "px";
    tip.querySelector("span")!.textContent = tipText(it);
    const dot = tip.querySelector("i")!;
    dot.style.background = it.status === "rejected" ? "#9DB0C3" : it.status === "approved" && LIVE ? "#FFD666" : hex(palette().person);
    dot.style.opacity = it.status === "frozen" ? String(FROZEN_A) : "";
    tip.classList.remove("off"); canvas.classList.add("hit");
  });
  on(canvas, "pointerleave", () => { if (tree.hover) { tree.hover = null; tree.draw(); } hideTip(); });

  let open: Fruit | null = null, busy = false;
  const ok = $<HTMLButtonElement>("rOk"), no = $<HTMLButtonElement>("rNo");
  function setButton(b: HTMLButtonElement, enabled: boolean, title: string) { b.disabled = !enabled; b.style.opacity = enabled ? "" : "0.55"; b.title = title; }
  function paintRule() {
    const it = open!.item!, [cls, txt] = statusChip(it.status), list = $("rList");
    $("rStatus").className = cls; $("rStatus").textContent = txt;
    list.innerHTML = "";
    if (it.gen) {
      const g = it.gen;
      $("rKind").textContent = "Best rule set this generation";
      $("rGen").textContent = `Generation ${g.gen} of ${ITEMS.length}`;
      $("rTxt").textContent = `${plural(g.rules, "rule")} · ${g.avgHops.toFixed(2)} avg hops`;
      g.ruleTexts.forEach((t) => { const li = document.createElement("li"); li.textContent = t; list.append(li); });
      $("rSaves").textContent = `Fitness ${Math.round(g.fitness * 100)}%`;
      setButton(ok, !busy && it.status !== "approved", "Approve: the agent routes by these rules");
      setButton(no, !busy && it.status !== "rejected", "Reject: it falls from the tree");
      const when = g.decidedAt ? ` ${new Date(g.decidedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
      $("rNote").textContent = busy ? "Saving…"
        : it.status === "approved" ? `Approved${when}. Darwin hints these rules to the agent's routing.`
        : it.status === "rejected" ? `Rejected${when}. Its rules stay off unless an approved generation carries them.`
        : "Approve and the agent routes by these rules; reject and the fruit falls. Saved as an event.";
      return;
    }
    const r = it.rule!;
    $("rKind").textContent = "Evolved routing rule";
    $("rGen").textContent = r.status === "frozen" ? "Rule · left for live learning" : `Rule · evolved in Gen ${r.gen}`;
    $("rTxt").textContent = r.text;
    $("rSaves").textContent = `Saves ${r.saves}`;
    setButton(ok, false, "Darwin isn't connected: this is a snapshot");
    setButton(no, false, "Darwin isn't connected: this is a snapshot");
    $("rNote").textContent = r.status === "frozen"
      ? "AVATAR learns this one live from replies, so Darwin never proposes it."
      : "Darwin isn't connected, so this is a snapshot of its latest run. Start Darwin and the agent to approve generations.";
  }
  function openRule(f: Fruit) {
    open = f; paintRule();
    const card = $("rule"), p = tree.toClient(f.x, f.y);
    card.classList.toggle("live", Boolean(LIVE)); card.classList.add("open");
    const w = card.offsetWidth || 300, h = card.offsetHeight || 250; // measured: a generation lists its rules
    let x = p.x > innerWidth / 2 ? p.x - w - 24 : p.x + 24, y = p.y - h / 2;
    x = Math.max(12, Math.min(innerWidth - w - 12, x)); y = Math.max(12, Math.min(innerHeight - h - 110, y)); // clear of the dock
    card.style.left = x + "px"; card.style.top = y + "px"; hideTip();
  }
  function closeRule() { $("rule").classList.remove("open"); open = null; }
  on(canvas, "click", (e: MouseEvent) => { if (!tree.done) return; const f = tree.ruleAt(e); if (f) openRule(f); else closeRule(); });
  if (LIVE) rows.forEach((row, i) => on(row, "click", () => {
    if (!tree.done) return;
    const f = tree.ruleFruit.find((x) => x.item === ITEMS[i]); if (f) openRule(f);
  }));
  on($("rClose"), "click", closeRule);
  on(window, "keydown", (e: KeyboardEvent) => { if (e.key === "Escape") closeRule(); });
  on($("regrow"), "click", grow);

  /** Move a fruit to match a status: approved glows (or rises back), rejected falls, proposed returns to its branch. */
  function show(it: Item, before: Status) {
    const f = tree.ruleFruit.find((x) => x.item === it);
    if (!f || !tree.done || before === it.status) return;
    if (it.status === "rejected") tree.drop(f);
    else if (f.fall) tree.lift(f);
    else if (it.status === "approved") tree.glow(f);
    tree.animate();
  }
  const settle = () => { if (open) paintRule(); paintRows(); if (tree.done) $("ruleCount").textContent = tally(); tree.draw(); };

  /* Approve / Reject a generation: the agent records an event and pushes the rules to Darwin. */
  async function decide(action: Action) {
    const f = open, it = f?.item;
    if (!LIVE || !it?.gen || busy) return;
    const before = it.status, after: Status = action === "approve" ? "approved" : "rejected";
    it.status = after; busy = true; show(it, before); settle();
    try {
      await LIVE.decide(it.gen.gen, action);
      it.gen.decidedAt = new Date().toISOString();
    } catch { // not saved: put the fruit back how it was
      const now = it.status; it.status = before; show(it, now);
    } finally { busy = false; settle(); }
  }
  on(ok, "click", () => void decide("approve"));
  on(no, "click", () => void decide("reject"));

  offs.push(onTheme(() => { if (!tree.raf && !tree.fx) tree.draw(); })); // re-tint by redrawing; a growing tree picks it up next frame
  grow();

  return {
    destroy() {
      tree.stop();
      offs.forEach((f) => f());
      timers.forEach((t) => clearTimeout(t));
      closeRule(); hideTip();
    },
    apply(gens) {
      if (!LIVE || busy) return;
      let changed = false;
      for (const g of gens) {
        const it = ITEMS.find((x) => x.gen?.gen === g.gen);
        if (!it || !it.gen) continue;
        it.gen.decidedAt = g.decidedAt;
        if (it.status === g.status) continue;
        const before = it.status; it.status = g.status; show(it, before); changed = true;
      }
      if (changed) settle();
    },
  };
}
