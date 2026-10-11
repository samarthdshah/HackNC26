// Aero runtime: the v6 shared/aero.js as a module (theme, toast, title card, tour).
// The dock and menu are React components (components/aero); everything else keeps the
// v6 DOM behaviour so ported page scripts work unchanged. Client-only.
import { prefetchVoice, speakLine, stopVoice } from "./voice";

export type Palette = {
  name: string;
  levels: number[];
  hub: number;
  person: number;
  match: number;
  accent: number;
  sky: number[];
};

export const PALETTES: Palette[] = [ // same per-level palettes as v4: root → outer shell, plus hub/person accents
  { name: "Aqua Sky", levels: [0x1a7fe0, 0x2fb5f5, 0x1fd1d1, 0x6fd9a8, 0x9fe8ff, 0xc8f3ff], hub: 0x1460c8, person: 0xffa63d, match: 0xff8fd0, accent: 0x1e8be0, sky: [0x0646a8, 0x2a8fe0, 0xbfe6fb] },
  { name: "Eco Leaf", levels: [0x2e9d4a, 0x57c84d, 0x8fdc5a, 0x30c9a0, 0xc6ef7a, 0xe2fbb0], hub: 0x1d7a3a, person: 0x2fb5f5, match: 0xffb84d, accent: 0x2e9d4a, sky: [0x0b6b6a, 0x3fb59a, 0xdff7d8] },
  { name: "Sunset Glass", levels: [0xff7a59, 0xffa94d, 0xffd166, 0xff6fa8, 0xffc2d6, 0xfff0c2], hub: 0xd9405e, person: 0x2fb5f5, match: 0xb48cff, accent: 0xff7a59, sky: [0x5a2a8a, 0xe0607a, 0xffe3c8] },
];

export type PageId = "home" | "roots" | "currents" | "insights" | "lagoon" | "darwin";

export const PAGES: { id: PageId; href: string; label: string; sq: string }[] = [
  { id: "home", href: "/", label: "Home Tree", sq: "green" },
  { id: "roots", href: "/roots", label: "Roots", sq: "teal" },
  { id: "currents", href: "/currents", label: "Currents", sq: "blue" },
  { id: "insights", href: "/insights", label: "Insights", sq: "amber" },
  { id: "lagoon", href: "/lagoon", label: "Lagoon", sq: "pink" },
  { id: "darwin", href: "/darwin", label: "Darwin", sq: "violet" },
];

const isBrowser = typeof window !== "undefined";
export const RM = isBrowser && matchMedia("(prefers-reduced-motion: reduce)").matches;

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

type ThemeFn = (i: number, p: Palette) => void;
const listeners = new Set<ThemeFn>();
let theme = isBrowser ? Math.min(2, Math.max(0, +(store.get("wf-theme") ?? 0) || 0)) : 0;

export const THEME_BOOT = `try{var t=Math.min(2,Math.max(0,+(localStorage.getItem('wf-theme')||0)||0));document.documentElement.dataset.theme=String(t)}catch(e){document.documentElement.dataset.theme='0'}`;

export function getTheme() { return theme; }
export function palette() { return PALETTES[theme]; }

export function setTheme(i: number) {
  theme = i;
  document.documentElement.dataset.theme = String(i);
  store.set("wf-theme", String(i));
  document.querySelectorAll<HTMLElement>(".theme-button[data-theme]").forEach((b) => b.classList.toggle("active", +b.dataset.theme! === i));
  listeners.forEach((fn) => { try { fn(i, PALETTES[i]); } catch (e) { console.error(e); } });
}

/** Re-tint on theme change. Returns an unsubscribe for the page's cleanup. */
export function onTheme(fn: ThemeFn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
export const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, RM ? 1 : ms));

/* ---------- Toasts: a stack top right, just left of the menu; new ones slide in below older ones ---------- */
export type ToastKind = "route" | "myc" | "evo" | "msg";
type ToastEl = HTMLDivElement & { hideT?: ReturnType<typeof setTimeout> };

function ensureToast() {
  let el = document.getElementById("toasts");
  if (el) return el;
  el = document.createElement("div");
  el.id = "toasts";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  document.body.appendChild(el);
  return el;
}

// kind: 'route' (green W), 'myc' (iridescent ✦), 'evo' (↯), 'msg' (chat bubble). m and s are trusted HTML.
export function toast(kind: ToastKind | string, k: string, m: string, s = "") {
  const box = ensureToast();
  const el = document.createElement("div") as ToastEl;
  const route = !["myc", "evo", "msg"].includes(kind);
  el.className = "toast" + (kind === "myc" ? " myc" : "");
  el.innerHTML = `<div class="in"><span class="${route ? "logo-orb" : "orb"}">${route ? "" : kind === "myc" ? "✦" : kind === "evo" ? "↯" : "✉"}</span><div><div class="k"></div><div class="m"></div><div class="s"></div></div></div>`;
  el.querySelector(".k")!.textContent = k;
  el.querySelector(".m")!.innerHTML = m;
  el.querySelector(".s")!.innerHTML = s;
  box.appendChild(el);
  void el.offsetWidth;
  el.classList.add("show"); // slides in from the right
  while (box.children.length > 4) box.firstElementChild!.remove(); // keep the stack short
  el.hideT = setTimeout(() => dismiss(el), 6500); // never parks on top of content
}

function dismiss(el: ToastEl) {
  clearTimeout(el.hideT);
  el.classList.remove("show");
  setTimeout(() => el.remove(), 600);
}
export function hideToast() {
  document.querySelectorAll<ToastEl>("#toasts .toast.show").forEach(dismiss);
}

/* ---------- Candy buttons: replay the icon animation on hover/focus ---------- */
export function wireCandy(scope: ParentNode = document) {
  scope.querySelectorAll<HTMLElement>(".ctl").forEach((b) => {
    if (b.dataset.wired) return;
    b.dataset.wired = "1";
    const sq = b.querySelector(".sq");
    if (!sq) return;
    (["mouseenter", "focus"] as const).forEach((ev) => b.addEventListener(ev, () => sq.classList.add("anim")));
    const end = sq.querySelector("[data-anim-end]") || sq.querySelector(".icon__part");
    end?.addEventListener("animationend", () => sq.classList.remove("anim"));
  });
}

/* ---------- Collapsible title card ---------- */
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

export function card(open?: boolean) {
  const c = document.querySelector(".title-card");
  if (!c) return;
  const on = open ?? c.classList.contains("collapsed");
  c.classList.toggle("collapsed", !on);
  c.querySelector(".tc-toggle")?.setAttribute("aria-expanded", String(on));
  window.dispatchEvent(new Event("resize"));
}

function wireCard() {
  const c = document.querySelector(".title-card");
  if (!c || !c.querySelector(".more") || c.querySelector(".tc-toggle")) return;
  const b = document.createElement("button");
  b.className = "tc-toggle";
  b.innerHTML = CHEV;
  b.setAttribute("aria-label", "Show details");
  b.setAttribute("aria-expanded", "false");
  b.addEventListener("click", (e) => { e.stopPropagation(); card(); });
  (c.querySelector(":scope > .bar") || c).appendChild(b);
  if (!new URLSearchParams(location.search).has("open")) {
    // React paints before this effect runs; collapse without the transition so the card
    // starts closed as in v6 instead of visibly folding up on load.
    const more = c.querySelector<HTMLElement>(".more");
    if (more) more.style.transition = "none";
    c.classList.add("collapsed");
    requestAnimationFrame(() => requestAnimationFrame(() => { if (more) more.style.transition = ""; }));
  }
}

/* ---------- Tour: spotlight each [data-tour] element in order ---------- */
let tourEl: HTMLElement | undefined;
let endActiveTour: (() => void) | undefined;

export type TourOpts = {
  voice?: boolean; // narrate each step with AVATAR's voice and advance when it finishes
  include?: (n: number) => boolean; // which data-tour steps to show (by their number)
  label?: string; // extra text for the step counter ("page 2 of 6")
  prefix?: string; // spoken before the first step
  onDone?: () => void; // the last step finished (not skipped)
  onLeave?: () => void; // the page unmounted mid-tour
  onSkip?: () => void; // the person pressed Skip or Escape
  waitMs?: number; // keep looking this long for steps (a page may still be loading its data)
  alive?: () => boolean; // false once this tour is no longer wanted (e.g. the person left the page)
};

export function tour(opts: TourOpts = {}) {
  if (opts.alive && !opts.alive()) return;
  const steps = [...document.querySelectorAll<HTMLElement>("[data-tour]")]
    .map((el) => { const [n, t, x] = el.dataset.tour!.split("|"); return { el, n: +n, t, x }; })
    .filter((s) => !opts.include || opts.include(s.n))
    .sort((a, b) => a.n - b.n);
  if (!steps.length) {
    if ((opts.waitMs ?? 0) > 0) { setTimeout(() => tour({ ...opts, waitMs: opts.waitMs! - 500 }), 500); return; }
    opts.onDone?.();
    return;
  }
  const tc = document.querySelector(".title-card");
  const wasCollapsed = tc?.classList.contains("collapsed");
  card(true);
  if (!tourEl) {
    tourEl = document.createElement("div");
    tourEl.id = "tour";
    tourEl.innerHTML = `<div class="spot"></div><div class="tour-tip milk still" role="dialog" aria-live="polite"><div class="body"><h4></h4><p></p>
        <div class="nav"><span class="n"></span><button class="pill ghost" data-t="skip">Skip</button><button class="pill ghost" data-t="back">Back</button><button class="pill" data-t="next">Next</button></div></div></div>`;
    document.body.appendChild(tourEl);
  }
  const host = tourEl;
  const spot = host.querySelector<HTMLElement>(".spot")!;
  const tip = host.querySelector<HTMLElement>(".tour-tip")!;
  const page = document.body.dataset.page;
  let i = 0, said = 0, over = false, voiceWarned = false;
  const visible = () => steps.filter((s) => s.el.isConnected && s.el.getClientRects().length && s.el.getBoundingClientRect().width > 0);
  const line = (s: { t: string; x: string }, k: number) => `${k === 0 && opts.prefix ? opts.prefix + " " : ""}${s.t}. ${s.x}`;
  const narrate = (k: number) => {
    const vis = visible(), s = vis[k], me = ++said;
    if (!s) return;
    if (vis[k + 1]) prefetchVoice(line(vis[k + 1], k + 1));
    const advance = () => { if (!over && me === said) go(1); };
    speakLine(line(s, k)).then(() => setTimeout(advance, 450)).catch((err: unknown) => {
      // No voice (no key, ElevenLabs down, or audio blocked): keep going at reading pace.
      if (!voiceWarned) toast("msg", "Voice unavailable", "The tour will continue without sound", String(err instanceof Error ? err.message : err).replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;")));
      voiceWarned = true;
      setTimeout(advance, Math.min(9000, 1800 + line(s, k).split(/\s+/).length * 330));
    });
  };
  const place = () => {
    const vis = visible();
    const s = vis[i];
    if (!s) return end("done");
    s.el.scrollIntoView?.({ block: "nearest", behavior: RM ? "auto" : "smooth" });
    if (opts.voice) narrate(i);
    setTimeout(() => {
      const r = s.el.getBoundingClientRect(), pad = 8, W = innerWidth, H = innerHeight;
      Object.assign(spot.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
      tip.querySelector("h4")!.textContent = s.t;
      tip.querySelector("p")!.textContent = s.x;
      tip.querySelector(".n")!.textContent = `${opts.voice ? "🔊 " : ""}${i + 1} of ${vis.length}${opts.label ? ` · ${opts.label}` : ""}`;
      tip.querySelector<HTMLElement>("[data-t=back]")!.style.visibility = i ? "visible" : "hidden";
      tip.querySelector("[data-t=next]")!.textContent = i === vis.length - 1 ? "Done" : "Next";
      const tw = Math.min(320, W - 24), th = tip.offsetHeight || 160;
      let x = r.right + 18, y = r.top; // prefer right of the target
      if (x + tw > W - 12) x = r.left - tw - 18; // else left
      if (x < 12) { x = Math.min(Math.max(12, r.left), W - tw - 12); y = r.bottom + 16 > H - th - 100 ? r.top - th - 16 : r.bottom + 16; } // else below/above
      y = Math.min(Math.max(12, y), H - th - 100);
      Object.assign(tip.style, { left: x + "px", top: y + "px", width: tw + "px" });
    }, RM ? 0 : 260);
  };
  const end = (why: "done" | "skip" | "leave" = "skip") => {
    if (over) return;
    over = true;
    if (opts.voice) stopVoice();
    host.classList.remove("on");
    document.removeEventListener("keydown", key);
    endActiveTour = undefined;
    store.set("wf-tour-" + page, "1");
    if (wasCollapsed !== false) card(false);
    (why === "done" ? opts.onDone : why === "leave" ? opts.onLeave : opts.onSkip)?.();
  };
  const go = (d: number) => {
    const n = steps.filter((s) => s.el.isConnected && s.el.getClientRects().length).length;
    i += d;
    if (i < 0) i = 0;
    if (i >= n) return end("done");
    place();
  };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") end("skip"); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
  tip.onclick = (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-t]")?.dataset.t;
    if (t === "skip") end("skip");
    if (t === "back") go(-1);
    if (t === "next") go(1);
  };
  spot.onclick = () => go(1);
  endActiveTour?.();
  endActiveTour = () => end("leave");
  document.addEventListener("keydown", key);
  host.classList.add("on");
  place();
}

/* ---------- Voice tour: AVATAR narrates every page's tour, then moves to the next page ---------- */
// Module state survives client-side navigation, so the tour carries on when the next page mounts.
let voice: { order: PageId[]; idx: number; navigating: boolean } | null = null;

export const voiceTourActive = () => Boolean(voice);

/** Start from the current page and visit all six (call from a click, after unlockVoice()). */
export function voiceTour() {
  const here = document.body.dataset.page as PageId;
  const start = Math.max(0, PAGES.findIndex((p) => p.id === here));
  voice = { order: [...PAGES.slice(start), ...PAGES.slice(0, start)].map((p) => p.id), idx: 0, navigating: false };
  runVoicePage();
}

export function stopVoiceTour() {
  voice = null;
  stopVoice();
  endActiveTour?.();
}

function runVoicePage() {
  if (!voice) return;
  const k = voice.idx, total = voice.order.length, pg = PAGES.find((p) => p.id === voice!.order[k])!;
  tour({
    voice: true,
    waitMs: 8000, // e.g. Currents shows "Loading…" (no tour steps) until its data arrives
    alive: () => voice !== null && voice.idx === k && document.body.dataset.page === pg.id,
    include: (n) => k === 0 || n < 90, // the dock and menu steps only once, on the first page
    label: `${pg.label}, page ${k + 1} of ${total}`,
    prefix: k === 0 ? `Welcome to AVATAR. Here's a guided tour of all ${total} pages, starting with ${pg.label}.` : `Next, ${pg.label}.`,
    onDone: nextVoicePage,
    onSkip: () => { voice = null; toast("msg", "Voice tour stopped", "Pick it up again from the menu", "🔊 Voice tour"); },
    onLeave: () => { if (voice && !voice.navigating) { voice = null; stopVoice(); } }, // the person navigated away themselves
  });
}

function nextVoicePage() {
  if (!voice) return;
  voice.idx++;
  if (voice.idx >= voice.order.length) {
    voice = null;
    toast("msg", "Tour complete", "That's all of AVATAR", "Text AVATAR a goal any time.");
    void speakLine("That's the tour of AVATAR. Text me a goal any time, and I'll find the people to make it happen.").catch(() => {});
    return;
  }
  voice.navigating = true;
  const href = PAGES.find((p) => p.id === voice!.order[voice!.idx])!.href;
  window.dispatchEvent(new CustomEvent("aero:navigate", { detail: href })); // the Menu routes client-side (keeps audio unlocked)
}

/**
 * Called by every page on mount: marks the active page (dock colour, --page accent),
 * wires the title card and candy buttons, and schedules the first-visit tour.
 * Returns the cleanup for the page's effect.
 */
export function enterPage(page: PageId, opts: { tourDelay?: number } = {}) {
  const body = document.body;
  body.dataset.page = page;
  body.classList.add("aero-page", "has-dock");
  wireCard();
  wireCandy();
  ensureToast();
  let tourTimer: ReturnType<typeof setTimeout> | undefined;
  const q = new URLSearchParams(location.search);
  if (voice && voice.order[voice.idx] === page) {
    // The voice tour just navigated here: narrate this page once its scene has settled.
    voice.navigating = false;
    tourTimer = setTimeout(runVoicePage, opts.tourDelay ?? 1400);
  } else if (voice) {
    voice = null; stopVoice(); // the person went somewhere else mid-tour
  } else if (!q.has("notour") && !store.get("wf-tour-" + page)) tourTimer = setTimeout(() => tour(), opts.tourDelay ?? 1400);
  window.dispatchEvent(new CustomEvent("aero:page", { detail: page }));
  return () => {
    clearTimeout(tourTimer);
    endActiveTour?.();
    hideToast();
  };
}

// Theme buttons anywhere on the page (menu, page-local) switch the theme.
if (isBrowser) {
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".theme-button[data-theme]");
    if (b) setTheme(+b.dataset.theme!);
  });
}

export const Aero = { PALETTES, PAGES, RM, get theme() { return theme; }, palette, hex, css, setTheme, onTheme, toast, hideToast, tour, voiceTour, stopVoiceTour, card, wireCandy, sleep };
export type AeroApi = typeof Aero;
