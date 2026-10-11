// Currents d3 scenes, ported from the v6 page script: the Roots mini-map and the animated path.
// Data comes from WF (lib/wf/build.ts); hop.who may be a person (p_*) or a department (dept_*).

import * as d3 from "d3";
import type { Verdict, WF, WfHop, WfQuery } from "@wayfinder/shared";
import type { WFHelpers } from "@/lib/wf/store";
import { RM } from "@/lib/aero/runtime";

const T = (ms: number) => (RM ? 1 : ms);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, T(ms)));

// Flat verdict colors; "you" follows the theme accent. forward is new (v6 had no "passed on").
export const VC: Record<Verdict | "start", string> = {
  start: "var(--accent)", redirect: "#F0715A", delegate: "#F2A114", forward: "#1FA889", approve: "#2E9E3A", answer: "#2E9E3A", pending: "#2A8CE8",
};
export const VERB: Record<Verdict, string> = {
  redirect: "redirected", delegate: "delegated", forward: "passed on", approve: "approved", answer: "answered", pending: "waiting",
};
const LEARN = "#2E9E3A";

/** Department a hop (or the viewer) sits in: a person's department, or the department itself. */
export const deptOfActor = (id: string, h: WFHelpers) => (id.startsWith("dept_") ? id : h.person(id)?.dept);

/* ============ Mini-map: the Roots graph, shrunk and faint ============ */
export function renderMini(el: SVGSVGElement, wf: WF, q: WfQuery, h: WFHelpers) {
  const svg = d3.select(el);
  svg.selectAll("*").remove();
  const meId = wf.me.id;
  const verdictOf = new Map<string, Verdict>();
  for (const hop of q.hops) verdictOf.set(hop.who, hop.verdict);
  const on = new Set([meId, ...q.hops.map((x) => x.who)]);
  const onDept = new Set(q.hops.map((x) => deptOfActor(x.who, h)).filter(Boolean) as string[]);
  const pos: Record<string, [number, number]> = {};
  const nD = wf.org.length;
  const g = svg.append("g");
  wf.org.forEach((d, i) => {
    const a = (i / nD) * Math.PI * 2 - Math.PI / 2, dx = Math.cos(a) * 62 * 1.45, dy = Math.sin(a) * 62 * 0.92;
    const lit = onDept.has(d.id);
    pos[d.id] = [dx, dy];
    g.append("line").attr("x1", 0).attr("y1", 0).attr("x2", dx).attr("y2", dy).attr("stroke", "var(--ink)").attr("stroke-opacity", lit ? 0.25 : 0.08).attr("stroke-width", 1);
    d.subs.forEach((s, j) => {
      const sa = a + (j - (d.subs.length - 1) / 2) * 0.42, sx = dx + Math.cos(sa) * 15, sy = dy + Math.sin(sa) * 12;
      g.append("line").attr("x1", dx).attr("y1", dy).attr("x2", sx).attr("y2", sy).attr("stroke", "var(--ink)").attr("stroke-opacity", lit ? 0.2 : 0.07);
      s.ids.forEach((id, k) => {
        const pa = sa + (k - (s.ids.length - 1) / 2) * 0.7, px = sx + Math.cos(pa) * 7, py = sy + Math.sin(pa) * 6;
        pos[id] = [px, py];
        const hit = on.has(id);
        g.append("circle").attr("cx", px).attr("cy", py).attr("r", hit ? 3.2 : 1.4)
          .attr("fill", hit ? (id === meId ? "var(--accent)" : VC[verdictOf.get(id)!] || "var(--accent)") : "var(--ink)")
          .attr("fill-opacity", hit ? 1 : 0.2).attr("stroke", hit ? "#fff" : "none").attr("stroke-width", 1);
      });
      g.append("circle").attr("cx", sx).attr("cy", sy).attr("r", 2.4).attr("fill", "var(--lv1)").attr("fill-opacity", lit ? 0.8 : 0.25);
    });
    // a department that is itself a hop takes that hop's verdict colour
    const asHop = verdictOf.get(d.id);
    g.append("circle").attr("cx", dx).attr("cy", dy).attr("r", 5).attr("fill", asHop ? VC[asHop] : "var(--hub)").attr("fill-opacity", lit ? 0.9 : 0.28).attr("stroke", "#fff").attr("stroke-opacity", lit ? 1 : 0.4);
    if (lit) g.append("text").attr("x", dx).attr("y", dy + (dy > 0 ? 15 : -9)).attr("text-anchor", "middle").attr("font-size", 7.5).attr("font-weight", 600).attr("fill", "var(--ink)").text(d.short ?? d.name);
  });
  // the query's path threaded through the map
  const chain = [meId, ...q.hops.map((x) => x.who)].map((id) => pos[id]).filter(Boolean);
  if (chain.length > 1) {
    g.append("path").attr("d", d3.line().curve(d3.curveCatmullRom.alpha(0.5))(chain) ?? "").attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 1.4).attr("stroke-dasharray", "3 2").lower();
  }
  g.append("circle").attr("r", 6).attr("fill", "var(--good)").attr("stroke", "#fff").attr("stroke-width", 1.2);
  g.append("text").attr("y", 2.6).attr("text-anchor", "middle").attr("font-size", 7).attr("font-weight", 700).attr("fill", "#fff").text("W");
  return [...onDept];
}

/* ============ Main flow ============ */
interface FlowNode { name: string; sub: string; init: string; verdict: Verdict | "start"; msg?: string; x: number; y: number }

const subLabel = (dept: string, team: string) => (dept === team ? dept : `${dept} · ${team}`);

export function flowNodes(wf: WF, q: WfQuery, h: WFHelpers): FlowNode[] {
  const me = wf.me;
  const hopNode = (x: WfHop): FlowNode => {
    const p = h.person(x.who), name = h.nameOf(x.who);
    return { name, sub: p ? subLabel(p.deptName, p.subName) : "Team", init: name.charAt(0).toUpperCase(), verdict: x.verdict, msg: x.msg, x: 0, y: 0 };
  };
  return [{ name: me.first, sub: subLabel(me.deptName, me.subName), init: me.first.charAt(0), verdict: "start", x: 0, y: 0 }, ...q.hops.map(hopNode)];
}

const W = 1000, Y = 210;
function edgePath(a: FlowNode, b: FlowNode, i: number) {
  const dx = b.x - a.x, bend = i % 2 ? 30 : -30;
  return `M${a.x},${a.y} C${a.x + dx * 0.4},${a.y + bend} ${b.x - dx * 0.4},${b.y + bend} ${b.x},${b.y}`;
}

export interface FlowCtx { svg: SVGSVGElement; tick: (text: string) => void; wf: WF; q: WfQuery; h: WFHelpers; firstText: string }

/** Plays the path once. Returns a cancel function (stops RAF, timers and transitions). */
export function playFlow({ svg: el, tick, wf, q, h, firstText }: FlowCtx) {
  let alive = true;
  const rafs = new Set<number>();
  const svg = d3.select(el);
  svg.interrupt().selectAll("*").interrupt();
  svg.selectAll("*").remove();
  const nodes = flowNodes(wf, q, h), n = nodes.length, pad = n <= 2 ? 260 : 90;
  nodes.forEach((d, i) => { d.x = n === 1 ? W / 2 : pad + ((W - pad * 2) * i) / (n - 1); d.y = Y; });
  const gLearn = svg.append("g"), gEdges = svg.append("g"), gNodes = svg.append("g"), gFx = svg.append("g");

  // all nodes laid out up front, hidden until reached
  const ng = gNodes.selectAll<SVGGElement, FlowNode>("g.node").data(nodes).join("g").attr("class", "node").attr("transform", (d) => `translate(${d.x},${d.y})`);
  const inner = ng.append("g").attr("class", "inner").attr("transform", (_d, i) => (i === 0 ? "scale(1)" : "scale(0)"));
  inner.filter((d) => d.verdict === "pending").append("circle").attr("class", "pulse").attr("r", 27).attr("fill", "none").attr("stroke", VC.pending).attr("stroke-width", 3);
  inner.append("circle").attr("r", 27).attr("fill", (d) => VC[d.verdict]).attr("stroke", "rgb(255 255 255 / .9)").attr("stroke-width", 4);
  inner.append("text").attr("class", "n-init").attr("text-anchor", "middle").attr("y", 6).text((d) => d.init);
  const lab = ng.append("g").attr("class", "lab").attr("opacity", (_d, i) => (i === 0 ? 1 : 0));
  lab.append("text").attr("class", "n-name").attr("text-anchor", "middle").attr("y", 54).text((d) => (d.verdict === "start" ? `${d.name} (you)` : d.name));
  lab.append("text").attr("class", "n-sub").attr("text-anchor", "middle").attr("y", 71).text((d) => d.sub);
  lab.append("text").attr("class", "n-verdict").attr("text-anchor", "middle").attr("y", 89).attr("fill", (d) => VC[d.verdict]).text((d) => (d.verdict === "start" ? "asked" : VERB[d.verdict]));

  const run = async () => {
    tick(`${wf.me.first} asks: "${firstText}"`);
    await wait(900); if (!alive) return;

    const edges: d3.Selection<SVGPathElement, unknown, null, undefined>[] = [];
    for (let i = 1; i < n; i++) {
      const a = nodes[i - 1], b = nodes[i];
      const path = gEdges.append("path").attr("d", edgePath(a, b, i)).attr("fill", "none").attr("stroke", VC[b.verdict]).attr("stroke-opacity", 0.75).attr("stroke-width", 3.5).attr("stroke-linecap", "round");
      const pel = path.node()!, len = pel.getTotalLength();
      path.attr("stroke-dasharray", len).attr("stroke-dashoffset", len);
      const comet = gFx.append("circle").attr("r", 8).attr("fill", VC[b.verdict]).attr("stroke", "#fff").attr("stroke-width", 2.5);
      await new Promise<void>((res) => {
        const t0 = performance.now(), dur = T(800);
        const step = (now: number) => {
          if (!alive) return res();
          const t = Math.min(1, (now - t0) / dur), e = d3.easeCubicInOut(t), p = pel.getPointAtLength(len * e);
          comet.attr("cx", p.x).attr("cy", p.y); path.attr("stroke-dashoffset", len * (1 - e));
          if (t < 1) { const id = requestAnimationFrame((x) => { rafs.delete(id); step(x); }); rafs.add(id); } else res();
        };
        const id = requestAnimationFrame((x) => { rafs.delete(id); step(x); }); rafs.add(id);
      });
      comet.remove(); if (!alive) return;
      edges.push(path);
      const gi = ng.filter((_d, k) => k === i);
      gi.select(".inner").transition().duration(T(520)).ease(d3.easeBackOut.overshoot(2)).attr("transform", "scale(1)");
      gi.select(".lab").transition().duration(T(400)).attr("opacity", 1);
      // numbered disc, as in the v2 hook scene
      const disc = gFx.append("g").attr("transform", `translate(${b.x + 24},${b.y - 26}) scale(0)`);
      disc.append("circle").attr("r", 13).attr("fill", "#fff").attr("stroke", "rgb(0 0 0 / .15)").attr("stroke-width", 1.5);
      disc.append("text").attr("class", "n-num").attr("text-anchor", "middle").attr("y", 4.5).text(i);
      disc.transition().duration(T(420)).ease(d3.easeBackOut).attr("transform", `translate(${b.x + 24},${b.y - 26}) scale(1)`);
      const said = b.msg && b.msg !== `Waiting on ${b.name}.` ? ` "${b.msg}"` : "";
      tick(b.verdict === "pending" ? `Hop ${i}: waiting on ${b.name}.${said}` : `Hop ${i}: ${b.name} ${VERB[b.verdict as Verdict]}.${said}`);
      await wait(1150); if (!alive) return;
    }

    const last = nodes[n - 1], first = nodes[0];
    if (n > 2 && q.learned) {
      await wait(500); if (!alive) return;
      edges.forEach((e) => e.transition().duration(T(600)).attr("stroke-opacity", 0.25 * 0.75));
      ng.filter((_d, k) => k > 0 && k < n - 1).transition().duration(T(600)).attr("opacity", 0.45);
      gFx.selectAll("g").filter((_d, k, all) => k < all.length - 1).transition().duration(T(600)).attr("opacity", 0.4);
      const lp = gLearn.append("path").attr("d", `M${first.x},${first.y - 30} C${first.x + 120},${Y - 190} ${last.x - 120},${Y - 190} ${last.x},${last.y - 30}`)
        .attr("fill", "none").attr("stroke", LEARN).attr("stroke-width", 4).attr("stroke-linecap", "round");
      const lel = lp.node()!, len = lel.getTotalLength();
      lp.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
        .transition().duration(T(900)).ease(d3.easeCubicInOut).attr("stroke-dashoffset", 0)
        .on("end", () => lp.attr("stroke-dasharray", "10 9"));
      await wait(900); if (!alive) return;
      const mid = lel.getPointAtLength(len / 2);
      const chip = gFx.append("g").attr("transform", `translate(${mid.x},${mid.y - 2})`).attr("opacity", 0);
      const txt = "Should have been 1 hop", cw = txt.length * 7.4 + 28;
      chip.append("rect").attr("x", -cw / 2).attr("y", -15).attr("width", cw).attr("height", 30).attr("rx", 15).attr("fill", "#E3F6EE").attr("stroke", LEARN).attr("stroke-width", 1.5);
      chip.append("text").attr("text-anchor", "middle").attr("y", 5).attr("font-size", 13).attr("font-weight", 600).attr("fill", "#0B6B4A").text(txt);
      chip.transition().duration(T(400)).attr("opacity", 1);
      tick(`Learned: ${q.learned.note}. Next time, one hop.`);
    } else if (n === 2 && q.status === "done" && last.verdict !== "pending") {
      tick(`Resolved in one hop by ${last.name}.`);
    }
  };
  void run();

  return () => {
    alive = false;
    rafs.forEach((id) => cancelAnimationFrame(id));
    svg.selectAll("*").interrupt();
  };
}
