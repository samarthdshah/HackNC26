// Darwin Growth scene, ported from the v6 page script: a canvas tree that grows one ring of
// branches per generation, with the evolved rules ripening as fruit. Data: wf.darwin / wf.rules
// (a Darwin run snapshot, see lib/wf/darwin.ts). Approve/Reject are disabled until live approval lands.

import type { WfGeneration, WfRule } from "@wayfinder/shared";
import { RM, hex, onTheme, palette } from "@/lib/aero/runtime";

export interface DarwinCtx {
  gens: WfGeneration[]; // the rings shown (already sampled to at most MAX_RINGS)
  totalGens: number; // generations in the run, for the footnote
  rules: WfRule[];
  replayed: number | null;
}

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
interface Fruit { progress: number; speed: number; x: number; y: number; r: number; tone: number; rule?: WfRule; rp: number; delay: number }

/* ============ Tree: the pasted canvas tree, grown once ============ */
class Tree {
  C: HTMLCanvasElement; c: CanvasRenderingContext2D;
  W = 800; H = 800; floorY = 685; S = 1;
  maxGenerations: number; rules: WfRule[];
  hover: Fruit | null = null; raf = 0;
  rand = Math.random; branches: Branch[] = []; fruit: Fruit[] = []; ruleFruit: Fruit[] = [];
  genDone: number[] = []; genComplete = 0; done = false;
  onGeneration: (n: number) => void = () => {};
  onSettled: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, gens: number, rules: WfRule[]) {
    this.C = canvas; this.c = canvas.getContext("2d")!;
    this.maxGenerations = Math.max(1, gens); this.rules = rules;
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
          if (b.generation === maxGenerations) this.fruit.push({ progress: 0, speed: 0.04 + this.rand() * 0.03, x: b.x2, y: b.y2, r: this.randomInt(3, 5), tone: this.randomInt(0, 2), rp: 0, delay: 0 });
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
    if (allFruit && !this.ruleFruit.length && this.rules.length) this.pickRules();
    if (allFruit && this.ruleFruit.every((f) => f.rp === 1)) { this.done = true; this.onSettled(); }
  }
  pickRules() { // spread the evolved rules evenly around the canopy, ripening in generation order
    const RULES = this.rules;
    const cx = 400, cy = 470, byAngle = [...this.fruit].sort((a, b) => Math.atan2(a.x - cx, cy - a.y) - Math.atan2(b.x - cx, cy - b.y));
    const n = RULES.length, picks = RULES.map((_, i) => byAngle[Math.floor(((i + 0.5) * byAngle.length) / n)]);
    const rank = (r: WfRule) => (r.status === "frozen" ? 1e3 : r.gen);
    const order = RULES.map((_, i) => i).sort((a, b) => rank(RULES[a]) - rank(RULES[b]));
    picks.forEach((f, i) => { f.rule = RULES[i]; f.rp = 0; f.delay = order.indexOf(i) * 7; });
    this.ruleFruit = picks;
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
    for (const f of this.fruit) if (!f.rule && f.progress > 0) this.orb(f.x, f.y, f.r * backOut(f.progress), k.fruit[f.tone], 0.92);
    // rule fruit: bigger, theme "person" color, a white ring once approved, grey when rejected, pale when frozen
    for (const f of this.ruleFruit) {
      if (f.rp <= 0) { this.orb(f.x, f.y, f.r, k.fruit[f.tone], 0.92); continue; }
      const st = f.rule!.status, r = 8.5 * backOut(f.rp), col = st === "rejected" ? [157, 176, 195] : k.rule;
      if (f === this.hover) { c.fillStyle = "rgb(255 255 255 / .55)"; c.beginPath(); c.arc(f.x, f.y, r + 7, 0, Math.PI * 2); c.fill(); }
      this.orb(f.x, f.y, r, col, st === "frozen" ? FROZEN_A : 1);
      if (st === "approved") { c.strokeStyle = "rgb(255 255 255 / .95)"; c.lineWidth = 1.6; c.beginPath(); c.arc(f.x, f.y, r + 2.2, 0, Math.PI * 2); c.stroke(); }
      if (st === "frozen") { c.setLineDash([2.5, 2.5]); c.strokeStyle = "rgb(255 255 255 / .9)"; c.lineWidth = 1.3; c.beginPath(); c.arc(f.x, f.y, r + 2.2, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
    }
  }
  loop = () => {
    this.grow(); this.draw();
    if (!this.done) this.raf = requestAnimationFrame(this.loop); else this.raf = 0;
  };
  start(seed: number) {
    cancelAnimationFrame(this.raf); this.raf = 0; this.reset(seed);
    if (RM) { this.finishInstantly(); this.draw(); return; }
    this.raf = requestAnimationFrame(this.loop);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  toLogical(e: PointerEvent | MouseEvent) { const r = this.C.getBoundingClientRect(); return { x: ((e.clientX - r.left) * this.W) / r.width, y: ((e.clientY - r.top) * this.H) / r.height }; }
  toClient(x: number, y: number) { const r = this.C.getBoundingClientRect(); return { x: r.left + (x * r.width) / this.W, y: r.top + (y * r.height) / this.H }; }
  ruleAt(e: PointerEvent | MouseEvent) {
    const p = this.toLogical(e); let best: Fruit | null = null, bd = 14;
    for (const f of this.ruleFruit) { if (f.rp < 1) continue; const d = Math.hypot(f.x - p.x, f.y - p.y); if (d < bd) { bd = d; best = f; } }
    return best;
  }
}

/** Mounts the scene on the page's static markup. Returns the cleanup. */
export function mount(root: HTMLElement, ctx: DarwinCtx) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const GENS = ctx.gens, RULES = ctx.rules.map((r) => ({ ...r }));
  const offs: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, ev: K | string, fn: (e: any) => void) => { el.addEventListener(ev, fn); offs.push(() => el.removeEventListener(ev, fn)); };
  const timers = new Set<ReturnType<typeof setTimeout>>();

  /* ============ Generations card ============ */
  $("genRows").innerHTML = GENS.map((g) => `<div class="row gen" data-gen="${g.gen}"><span class="orb sm"></span><span class="nm">Gen ${g.gen}</span>
  <span class="fit" title="Fitness ${g.fitness}"><i style="--w:${Math.round(g.fitness * 100)}%"></i></span><span class="hp">${g.avgHops.toFixed(2)} hops</span><span class="chip info">${g.rules}</span></div>`).join("");
  const rows = [...root.querySelectorAll<HTMLElement>(".gen")];
  const seeding = ctx.replayed ? `Seeding from ${ctx.replayed.toLocaleString()} resolved requests` : "Seeding from past requests";
  function setGen(n: number) {
    rows.forEach((r, i) => { r.classList.toggle("done", i < n); r.classList.toggle("on", i === n - 1); });
    const g = GENS[n - 1], el = $("genN");
    if (!g) { el.textContent = "Gen 0"; $("genH").textContent = "–"; $("genFrom").textContent = seeding; $("ruleCount").textContent = "0 rules"; return; }
    el.textContent = `Gen ${g.gen}`; $("genH").textContent = g.avgHops.toFixed(2);
    $("genFrom").textContent = n === 1 ? "Replaying the old routes" : `projected · down from ${GENS[0].avgHops.toFixed(2)} at Gen ${GENS[0].gen} · fitness ${g.fitness.toFixed(2)}`;
    $("ruleCount").textContent = `${g.rules} ${g.rules === 1 ? "rule" : "rules"}`;
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    const t = setTimeout(() => { timers.delete(t); el.classList.remove("bump"); }, 450); timers.add(t);
  }
  function setLive(evolving: boolean) { $("liveTxt").textContent = evolving ? "evolving" : "settled"; $("liveDot").style.background = evolving ? "#FFC24D" : ""; $("liveDot").style.boxShadow = evolving ? "0 0 8px #FFC24D" : ""; }

  /* ============ Wire up ============ */
  const canvas = $<HTMLCanvasElement>("tree");
  const tree = new Tree(canvas, GENS.length, RULES);
  tree.onGeneration = (n) => { tree.genComplete = n; setGen(n); };
  tree.onSettled = () => {
    setLive(false);
    const last = GENS.at(-1);
    const live = RULES.filter((r) => r.status !== "frozen").length;
    $("ruleCount").textContent = `${last?.rules ?? live} rules · ${RULES.length} on the tree`;
  };
  on(window, "resize", () => { tree.setupCanvas(); tree.draw(); });
  let seed = 7;
  function grow() { closeRule(); hideTip(); setGen(0); setLive(true); tree.start(seed++); }

  const tip = $("tip");
  function hideTip() { tip.classList.add("off"); canvas.classList.remove("hit"); }
  function statusChip(s: WfRule["status"]): [string, string] {
    return s === "approved" ? ["chip", "Approved"] : s === "rejected" ? ["chip bad", "Rejected"] : s === "frozen" ? ["chip info", "Left for live learning"] : ["chip warn", "Proposed · needs admin"];
  }
  const label = (r: WfRule) => (r.status === "frozen" ? "Live learning" : `Gen ${r.gen}`);
  on(canvas, "pointermove", (e: PointerEvent) => {
    if (!tree.done) return;
    const f = tree.ruleAt(e);
    if (f !== tree.hover) { tree.hover = f; tree.draw(); }
    if (!f) return hideTip();
    const p = tree.toClient(f.x, f.y);
    tip.style.left = p.x + "px"; tip.style.top = p.y + "px";
    tip.querySelector("span")!.textContent = `${label(f.rule!)} · ${f.rule!.text}`;
    const dot = tip.querySelector("i")!;
    dot.style.background = f.rule!.status === "rejected" ? "#9DB0C3" : hex(palette().person);
    dot.style.opacity = f.rule!.status === "frozen" ? String(FROZEN_A) : "";
    tip.classList.remove("off"); canvas.classList.add("hit");
  });
  on(canvas, "pointerleave", () => { if (tree.hover) { tree.hover = null; tree.draw(); } hideTip(); });

  let open: Fruit | null = null;
  function paintRule() {
    const r = open!.rule!, [cls, txt] = statusChip(r.status);
    $("rGen").textContent = r.status === "frozen" ? "Rule · left for live learning" : `Rule · evolved in Gen ${r.gen}`;
    $("rTxt").textContent = r.text;
    $("rSaves").textContent = `Saves ${r.saves}`; $("rStatus").className = cls; $("rStatus").textContent = txt;
    $("rNote").textContent = r.status === "frozen"
      ? "Wayfinder learns this one live from replies, so Darwin never proposes it."
      : "Live approval coming soon. This is a snapshot of Darwin's latest run.";
  }
  function openRule(f: Fruit) {
    open = f; paintRule();
    const card = $("rule"), p = tree.toClient(f.x, f.y), w = 300, h = 250;
    let x = p.x > innerWidth / 2 ? p.x - w - 24 : p.x + 24, y = p.y - h / 2;
    x = Math.max(12, Math.min(innerWidth - w - 12, x)); y = Math.max(12, Math.min(innerHeight - h - 110, y));
    card.style.left = x + "px"; card.style.top = y + "px"; card.classList.add("open"); hideTip();
  }
  function closeRule() { $("rule").classList.remove("open"); open = null; }
  on(canvas, "click", (e: MouseEvent) => { if (!tree.done) return; const f = tree.ruleAt(e); if (f) openRule(f); else closeRule(); });
  on($("rClose"), "click", closeRule);
  on(window, "keydown", (e: KeyboardEvent) => { if (e.key === "Escape") closeRule(); });
  on($("regrow"), "click", grow);

  offs.push(onTheme(() => { if (!tree.raf) tree.draw(); })); // re-tint by redrawing; a growing tree picks it up next frame
  grow();

  return () => {
    tree.stop();
    offs.forEach((f) => f());
    timers.forEach((t) => clearTimeout(t));
    closeRule(); hideTip();
  };
}
