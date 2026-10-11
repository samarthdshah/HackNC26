// Insights scene: the imperative parts of docs/design/v6/insights.html <script>.
// mount() owns the page-lifetime bits (soap bubbles, the toast); drawGain and drawChord are
// data-driven and re-run on a WF refresh (animating only the first time).

import { gsap } from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import * as d3 from "d3";
import type { WF } from "@wayfinder/shared";
import type { WFHelpers } from "@/lib/wf/store";
import { RM, css as cssVar, toast, hideToast } from "@/lib/aero/runtime";

gsap.registerPlugin(DrawSVGPlugin, MotionPathPlugin);

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
/** Hours: one decimal under 100 so small real numbers (12.7 h) are not rounded away. */
export const hrs = (n: number) => (Math.abs(n) < 100 ? (Math.round(n * 10) / 10).toLocaleString("en-US") : fmt(n));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Run fn once when el scrolls into view. Returns a cleanup. (No window 'load' fallback: in the
 *  app the page mounts after load, so the on-screen check runs straight away instead.) */
export function onView(el: Element, fn: () => void, threshold = 0.35) {
  let done = false;
  const go = () => { if (done) return; done = true; io?.disconnect(); fn(); };
  if (!("IntersectionObserver" in window)) { go(); return () => {}; }
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) go(); }), { threshold });
  io.observe(el);
  const r = el.getBoundingClientRect();
  if (r.top < innerHeight * (1 - threshold) && r.bottom > 0) go();
  return () => { done = true; io.disconnect(); };
}

/* ============ Soap bubbles drifting behind + the arrival toast ============ */
export function mount(root: HTMLElement, ctx: { wf: WF }): () => void {
  const cv = root.querySelector<HTMLCanvasElement>("#bubbles")!, cx = cv.getContext("2d")!;
  let BW = 0, BH = 0, raf = 0;
  let bubbles: { x: number; y: number; r: number; v: number; ph: number }[] = [];
  const sizeBubbles = () => { const d = Math.min(devicePixelRatio, 2); BW = innerWidth; BH = innerHeight; cv.width = BW * d; cv.height = BH * d; cx.setTransform(d, 0, 0, d, 0, 0); };
  const seedBubbles = () => {
    const n = Math.round(Math.min(34, BW / 40));
    bubbles = Array.from({ length: n }, () => ({ x: Math.random() * BW, y: Math.random() * BH, r: 6 + Math.random() * (Math.random() < 0.12 ? 46 : 22), v: 0.15 + Math.random() * 0.45, ph: Math.random() * 6.28 }));
  };
  function drawBubbles(t: number) {
    cx.clearRect(0, 0, BW, BH);
    for (const b of bubbles) {
      if (!RM) { b.y -= b.v; b.x += Math.sin(t * 0.0004 + b.ph) * 0.25; if (b.y < -b.r * 2) { b.y = BH + b.r * 2; b.x = Math.random() * BW; } }
      const g = cx.createRadialGradient(b.x, b.y, b.r * 0.6, b.x, b.y, b.r);
      g.addColorStop(0, "rgba(255,255,255,0.03)"); g.addColorStop(0.85, "rgba(255,255,255,0.12)"); g.addColorStop(1, "rgba(255,255,255,0.45)");
      cx.fillStyle = g; cx.beginPath(); cx.arc(b.x, b.y, b.r, 0, 6.283); cx.fill();
      const hue = (t * 0.02 + b.ph * 57) % 360; // iridescent rim
      cx.strokeStyle = `hsla(${hue},90%,80%,0.35)`; cx.lineWidth = 1.2; cx.beginPath(); cx.arc(b.x, b.y, b.r - 0.6, Math.PI * 0.1, Math.PI * 0.9); cx.stroke();
      cx.fillStyle = "rgba(255,255,255,0.75)"; cx.beginPath(); cx.ellipse(b.x - b.r * 0.38, b.y - b.r * 0.42, b.r * 0.22, b.r * 0.12, -0.6, 0, 6.283); cx.fill();
    }
    if (!RM) raf = requestAnimationFrame(drawBubbles);
  }
  sizeBubbles(); seedBubbles(); raf = requestAnimationFrame(drawBubbles);
  const onResize = () => { sizeBubbles(); if (RM) drawBubbles(0); };
  addEventListener("resize", onResize);

  const S = ctx.wf.stats;
  const t1 = setTimeout(() => innerWidth > 1100 && toast("route", "Insights refreshed", `${hrs(S.hoursSaved)} hours handed back`,
    `avg hops <span class="hops">${S.avgHopsBefore} → ${S.avgHopsAfter ?? "—"}</span>`), RM ? 0 : 1800);
  const t2 = setTimeout(hideToast, RM ? 4000 : 7500);

  return () => { cancelAnimationFrame(raf); removeEventListener("resize", onResize); clearTimeout(t1); clearTimeout(t2); hideToast(); };
}

/* ============ Gain radial graph (pasted pen, ported to GSAP 3): where time is lost ============ */
export type GainRow = { name: string; tag: string; detail: string; value: number };
const ringY = [180, 140, 100, 60, 20];

/** rows: inner ring first (smallest). animate=false jumps to the end (data refresh, reduced motion). */
export function drawGain(svg: SVGSVGElement, rows: GainRow[], opts: { animate: boolean }) {
  const q = <T extends Element>(s: string) => [...svg.querySelectorAll<T>(s)];
  const one = (s: string) => svg.querySelector<SVGElement>(s)!;
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag: string, attrs: Record<string, string | number>, parent: Element) => {
    const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, String(attrs[k])); parent.appendChild(e); return e;
  };
  const peopleG = one("#people"), valsG = one("#vals");
  peopleG.replaceChildren(); valsG.replaceChildren();
  const maxH = Math.max(...rows.map((r) => r.value)) || 1, percs = rows.map((r) => r.value / maxH);
  rows.forEach((d, i) => {
    const g = mk("g", { class: "person" }, peopleG), y = ringY[i];
    const nm = mk("text", { class: "nm", x: 484, y: y + 3 }, g); nm.textContent = d.name.toUpperCase();
    const ts = mk("tspan", { dx: 8 }, nm); ts.textContent = d.tag;
    const jt = mk("text", { class: "jt", x: 484, y: y + 21 }, g); jt.textContent = d.detail;
    const v = mk("text", { class: "val", "text-anchor": "middle", "dominant-baseline": "central" }, valsG); v.textContent = hrs(d.value);
  });
  const lines = q<SVGPathElement>("#top-lines .line"), circs = q<SVGCircleElement>("#circles .circ"), vals = q<SVGTextElement>("#vals .val");
  // the pen placed values on the circles once they stopped: same idea, measured from the arc
  vals.forEach((v, i) => { const L = lines[i], p = L.getPointAtLength(L.getTotalLength() * percs[i]); v.setAttribute("x", String(p.x)); v.setAttribute("y", String(p.y)); });

  const centre = one("#center-circ"), txt = one("#gainTxt"), horz = q("#horz-lines line"), people = q("#people .person");
  const baseP = q("#base-lines path"), midP = q("#mid-lines path");
  gsap.set(svg, { visibility: "visible" });
  gsap.set(centre, { transformOrigin: "50% 50%" });
  gsap.set(horz, { transformOrigin: "0% 50%" });
  const base = 0.7;
  const tl = gsap.timeline({ paused: true });
  tl.fromTo(centre, { scale: 0 }, { scale: 1, duration: base, delay: 0.2, ease: "elastic.out(0.5,0.4)" }, 0.15)
    .fromTo(txt, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "none" }, "-=0.5")
    // circles rise out of the centre to the top of their ring (the pen's staggerFrom y)
    .fromTo(circs, { x: 375, y: 250, opacity: 0 }, { x: 375, y: (i: number) => ringY[i], opacity: 1, duration: base * 3, ease: "power3.inOut", stagger: 0.15 }, "-=0.8")
    .fromTo(baseP, { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: base, ease: "power2.inOut", stagger: 0.15 }, "-=1.3")
    .fromTo(midP, { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: base, ease: "power2.inOut", stagger: 0.15 }, "-=1.1")
    .fromTo(lines, { drawSVG: "0% 0%" }, { drawSVG: ((i: number) => `0% ${percs[i] * 100}%`) as unknown as string, duration: base * 2, ease: "power3.inOut", stagger: 0.15 }, "-=0.3")
    .fromTo(horz, { scaleX: 0 }, { scaleX: 1, duration: base / 2, ease: "power2.out", stagger: 0.15 }, "-=2.4")
    .fromTo(people, { opacity: 0, x: 20 }, { opacity: 1, x: 0, duration: base / 2, ease: "power2.out", stagger: 0.1 }, "-=2.2");
  // circles ride their arcs (MotionPathPlugin replaces pathDataToBezier + bezier tweens)
  circs.forEach((c, i) => tl.to(c, { motionPath: { path: lines[i], start: 0, end: percs[i] }, duration: base * 2, ease: "power3.inOut", immediateRender: false }, i === 0 ? "-=2" : "-=1.85"));
  tl.fromTo(vals, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "none" });

  gsap.set(circs, { x: 375, y: 250, opacity: 0 }); gsap.set([...baseP, ...midP, ...lines], { drawSVG: "0% 0%" }); gsap.set(centre, { scale: 0 });
  gsap.set([...people, txt, ...vals], { opacity: 0 }); gsap.set(horz, { scaleX: 0 });
  const play = () => (RM ? tl.progress(1) : tl.restart());
  if (!opts.animate) tl.progress(1);
  return { play, kill: () => { tl.kill(); } };
}

/* ============ d3 chord: department → department routing ============ */
export function drawChord(svgEl: SVGSVGElement, detailEl: HTMLElement, wf: WF, helpers: WFHelpers, st: { pinned: number | null; animate: boolean }) {
  const org = wf.org, ids = org.map((d) => d.id), n = ids.length;
  const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  wf.routing.forEach(([a, b, v]) => { const i = ids.indexOf(a), j = ids.indexOf(b); if (i >= 0 && j >= 0) matrix[i][j] += v; });
  const deptName = (id: string) => helpers.dept(id)?.name ?? wf.actorNames[id] ?? id;
  // v6: one 3-colour family (primary → secondary → warm) instead of unrelated hues
  const cols = d3.quantize(d3.interpolateRgbBasis([cssVar("--c-primary"), cssVar("--c-secondary"), cssVar("--c-warm")]), Math.max(2, n));
  const svg = d3.select(svgEl), R0 = 205, R1 = 226;
  svg.selectAll("*").interrupt().remove();
  const chords = d3.chordDirected().padAngle(0.045).sortSubgroups(d3.descending)(matrix);
  const defs = svg.append("defs"), gl = defs.append("radialGradient").attr("id", "arcGloss");
  gl.append("stop").attr("offset", "86%").attr("stop-color", "#fff").attr("stop-opacity", 0);
  gl.append("stop").attr("offset", "100%").attr("stop-color", "#fff").attr("stop-opacity", 0.55);
  const ribbon = d3.ribbonArrow<d3.Chord, d3.ChordSubgroup>().radius(R0 - 4).headRadius(10);
  const arc = d3.arc<d3.ChordGroup>().innerRadius(R0).outerRadius(R1);
  svg.append("g").selectAll("path").data(chords).join("path").attr("class", "rib").attr("d", (d) => ribbon(d) as unknown as string).attr("fill", (d) => cols[d.source.index])
    .append("title").text((d) => `${org[d.source.index].name} → ${org[d.target.index].name}: ${d.source.value} requests`);
  const g = svg.append("g").selectAll("g").data(chords.groups).join("g").attr("class", "grp");
  g.append("path").attr("d", arc).attr("fill", (d) => cols[d.index]);
  g.append("path").attr("d", arc).attr("fill", "url(#arcGloss)").style("pointer-events", "none");
  const mid = (d: d3.ChordGroup) => (d.startAngle + d.endAngle) / 2;
  g.append("text")
    .attr("transform", (d) => `rotate(${(mid(d) * 180) / Math.PI - 90}) translate(${R1 + 10}) ${mid(d) > Math.PI ? "rotate(180)" : ""}`)
    .attr("text-anchor", (d) => (mid(d) > Math.PI ? "end" : "start")).attr("dy", ".35em").text((d) => org[d.index].short);
  g.on("mouseenter", (_e, d) => isolate(d.index)).on("mouseleave", () => isolate(st.pinned))
    .on("click", (_e, d) => { st.pinned = st.pinned === d.index ? null : d.index; isolate(st.pinned); });
  if (st.animate && !RM) svg.selectAll(".rib").attr("opacity", 0).transition().duration(900).delay((_d, i) => i * 40).attr("opacity", null);
  isolate(st.pinned);

  function isolate(i: number | null) {
    const on = i != null; svg.classed("iso", on);
    svg.selectAll<SVGPathElement, d3.Chord>(".rib").classed("on", (d) => on && (d.source.index === i || d.target.index === i));
    svg.selectAll<SVGGElement, d3.ChordGroup>(".grp").classed("on", (d) => on && d.index === i);
    detail(i);
  }
  function detail(i: number | null) {
    const row = (c: string, t: string, s: string, v: number | string) =>
      `<div class="row"><span class="dot" style="background:${c}"></span><div><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div><span class="v">${v}</span></div>`;
    if (i == null) {
      const top = [...wf.routing].sort((a, b) => b[2] - a[2]).slice(0, 4), total = wf.routing.reduce((s, r) => s + r[2], 0);
      detailEl.innerHTML = `<div class="k">All departments</div><div class="big">${fmt(total)} <small class="muted" style="font-size:16px">routed requests</small></div>
        <p class="page-sub" style="margin-top:4px">Hover or tap a department to isolate its routes. Arrows point to who answered.</p>
        <div class="rows">${top.map(([a, b, v]) => row(cols[ids.indexOf(a)], `${deptName(a)} → ${deptName(b)}`, "busiest lane", v)).join("")}</div>`;
      return;
    }
    const d = org[i], out = wf.routing.filter((r) => r[0] === d.id), inn = wf.routing.filter((r) => r[1] === d.id);
    const bd = wf.byDept.find((x) => x.id === d.id);
    const sum = (a: typeof out) => a.reduce((s, r) => s + r[2], 0);
    const rows = [
      ...out.map((r) => ({ lbl: `→ ${deptName(r[1])}`, s: "sends to", v: r[2], c: ids.indexOf(r[1]) })),
      ...inn.map((r) => ({ lbl: `← ${deptName(r[0])}`, s: "receives from", v: r[2], c: ids.indexOf(r[0]) })),
    ].sort((a, b) => b.v - a.v).slice(0, 5);
    const people = d.subs.flatMap((s) => s.people);
    const chips = [`<span class="chip info">${sum(out)} sent</span>`, `<span class="chip info">${sum(inn)} received</span>`];
    if (bd) {
      chips.push(`<span class="chip">${bd.hopsBefore} → ${bd.hopsAfter ?? "live"} hops</span>`);
      chips.push(`<span class="chip">${hrs(bd.hoursLost)} h lost</span>`);
    }
    detailEl.innerHTML = `<div class="k">${esc(d.subs.map((s) => s.name).join(" · "))}</div><div class="big" style="display:flex;align-items:center;gap:10px"><span class="dot" style="width:18px;height:18px;background:${cols[i]}"></span>${esc(d.name)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${chips.join("")}</div>
      ${people.length ? `<p class="page-sub" style="margin-top:8px;font-size:13px">${esc(people.join(", "))}</p>` : ""}
      <div class="rows">${rows.map((r) => row(cols[r.c], r.lbl, r.s, r.v)).join("")}</div>`;
  }
  return () => { svg.selectAll("*").interrupt(); };
}
