// Aero runtime: the v6 shared/aero.js as a module (theme, toast, title card, tour).
// The dock and menu are React components (components/aero); everything else keeps the
// v6 DOM behaviour so ported page scripts work unchanged. Client-only.

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

/* ---------- Toast ---------- */
export type ToastKind = "route" | "myc" | "evo" | "msg";
let toastT: ReturnType<typeof setTimeout> | undefined;

function ensureToast() {
  let el = document.getElementById("toast");
  if (el) return el;
  el = document.createElement("div");
  el.id = "toast";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="in"><span class="orb" id="tOrb">W</span><div><div class="k" id="tK"></div><div class="m" id="tM"></div><div class="s" id="tS"></div></div></div>`;
  document.body.appendChild(el);
  return el;
}

// kind: 'route' (green W), 'myc' (iridescent ✦), 'evo' (↯), 'msg' (chat bubble). m and s are trusted HTML.
export function toast(kind: ToastKind | string, k: string, m: string, s = "") {
  const el = ensureToast();
  el.classList.toggle("myc", kind === "myc");
  el.querySelector("#tK")!.textContent = k;
  el.querySelector("#tM")!.innerHTML = m;
  el.querySelector("#tS")!.innerHTML = s;
  const o = el.querySelector<HTMLElement>("#tOrb")!;
  const route = !["myc", "evo", "msg"].includes(kind);
  o.className = route ? "logo-orb" : "orb";
  o.textContent = route ? "" : kind === "myc" ? "✦" : kind === "evo" ? "↯" : "✉";
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(hideToast, 6500); // never parks on top of content
}
export function hideToast() { document.getElementById("toast")?.classList.remove("show"); }

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

export function tour() {
  const steps = [...document.querySelectorAll<HTMLElement>("[data-tour]")]
    .map((el) => { const [n, t, x] = el.dataset.tour!.split("|"); return { el, n: +n, t, x }; })
    .sort((a, b) => a.n - b.n);
  if (!steps.length) return;
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
  let i = 0;
  const place = () => {
    const vis = steps.filter((s) => s.el.isConnected && s.el.getClientRects().length && s.el.getBoundingClientRect().width > 0);
    const s = vis[i];
    if (!s) return end();
    s.el.scrollIntoView?.({ block: "nearest", behavior: RM ? "auto" : "smooth" });
    setTimeout(() => {
      const r = s.el.getBoundingClientRect(), pad = 8, W = innerWidth, H = innerHeight;
      Object.assign(spot.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
      tip.querySelector("h4")!.textContent = s.t;
      tip.querySelector("p")!.textContent = s.x;
      tip.querySelector(".n")!.textContent = `${i + 1} of ${vis.length}`;
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
  const end = () => {
    host.classList.remove("on");
    document.removeEventListener("keydown", key);
    endActiveTour = undefined;
    store.set("wf-tour-" + page, "1");
    if (wasCollapsed !== false) card(false);
  };
  const go = (d: number) => {
    const n = steps.filter((s) => s.el.isConnected && s.el.getClientRects().length).length;
    i += d;
    if (i < 0) i = 0;
    if (i >= n) return end();
    place();
  };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") end(); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
  tip.onclick = (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-t]")?.dataset.t;
    if (t === "skip") end();
    if (t === "back") go(-1);
    if (t === "next") go(1);
  };
  spot.onclick = () => go(1);
  endActiveTour?.();
  endActiveTour = end;
  document.addEventListener("keydown", key);
  host.classList.add("on");
  place();
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
  if (!q.has("notour") && !store.get("wf-tour-" + page)) tourTimer = setTimeout(tour, opts.tourDelay ?? 1400);
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

export const Aero = { PALETTES, PAGES, RM, get theme() { return theme; }, palette, hex, css, setTheme, onTheme, toast, hideToast, tour, card, wireCandy, sleep };
export type AeroApi = typeof Aero;
