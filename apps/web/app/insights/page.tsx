"use client";
// Insights: port of docs/design/v6/insights.html. Numbers, skill bars and Recharts are React
// (they re-render on every WF refresh); bubbles, the gain radial and the chord live in scene.ts.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { gsap } from "gsap";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WF } from "@wayfinder/shared";
import { useAeroPage } from "@/lib/aero/usePage";
import { useWF } from "@/lib/wf/store";
import { RM, css as cssVar, onTheme } from "@/lib/aero/runtime";
import { css } from "./style";
import { drawChord, drawGain, fmt, hrs, mount, onView, type GainRow } from "./scene";

/* ============ KPI tiles ============ */
type Kpi = { k: string; to: number; from?: number; f: (v: number) => string; pre?: string; suf?: string; spark?: number[]; chip: string; cls?: string };

const mins = (v: number) => {
  const h = Math.floor(v / 60);
  return h >= 48 ? `${(v / 1440).toFixed(1)} d` : `${h} h ${Math.round(v % 60)} m`;
};

function kpis(wf: WF): Kpi[] {
  const S = wf.stats, ser = wf.series, last = ser.at(-1);
  const after = S.medianResolveMs;
  return [
    { k: "Hours lost", to: S.hoursLost, f: hrs, suf: "h", spark: ser.map((d) => d.hoursLost), chip: "“not us” replies" },
    { k: "Hours saved", to: S.hoursSaved, f: hrs, suf: "h", spark: ser.map((d) => d.hoursSaved), chip: "paging + live", cls: "info" },
    { k: "Requests routed", to: S.requestsRouted, f: fmt, spark: ser.map((d) => d.requests), chip: `${fmt(last?.requests ?? 0)} this wk` },
    after != null
      ? { k: "Median resolve", to: after / 60000, f: mins, chip: `was ${S.medianBefore}` }
      : { k: "Median resolve", to: S.medianBeforeMs / 60000, f: mins, chip: "before Wayfinder" },
    { k: "Intros made", to: S.introsMade, f: fmt, chip: "Mycelium", cls: "info" },
    { k: "Text approvals", to: S.approvalsByText, f: fmt, chip: "no portals" },
    S.avgHopsAfter != null
      ? { k: "Avg hops", from: S.avgHopsBefore, to: S.avgHopsAfter, f: (v) => v.toFixed(1), pre: `${S.avgHopsBefore} → `, spark: ser.map((d) => d.hops),
          chip: `−${Math.round((1 - S.avgHopsAfter / (S.avgHopsBefore || 1)) * 100)}%` }
      : { k: "Avg hops", to: S.avgHopsBefore, f: (v) => v.toFixed(1), spark: ser.map((d) => d.hops), chip: "after: live" },
  ];
}

function sparkPath(vals: number[], w = 84, h = 26) {
  const lo = Math.min(...vals), hi = Math.max(...vals), sx = w / (vals.length - 1 || 1), y = (v: number) => h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4);
  const pts = vals.map((v, i) => [i * sx, y(v)]), line = "M" + pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join("L");
  return { line, area: `${line}L${w},${h}L0,${h}Z`, end: pts.at(-1)! };
}

function Tile({ t, i, go }: { t: Kpi; i: number; go: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [done, setDone] = useState(RM);
  useEffect(() => {
    if (!go || done || !ref.current) return;
    const o = { v: t.from ?? 0 }, el = ref.current;
    const tw = gsap.to(o, { v: t.to, duration: 1.6, delay: i * 0.08, ease: "power3.out", onUpdate: () => { el.textContent = t.f(o.v); }, onComplete: () => setDone(true) });
    return () => { tw.kill(); };
  }, [go]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = t.spark && t.spark.length > 1 ? sparkPath(t.spark) : null;
  return (
    <div className="tile">
      <div className="k">{t.k}</div>
      <div className="num">{t.pre ? <small>{t.pre}</small> : null}<span ref={ref}>{t.f(done ? t.to : t.from ?? 0)}</span>{t.suf ? <small> {t.suf}</small> : null}</div>
      <div className="foot">
        <span className={"chip " + (t.cls ?? "")}>{t.chip}</span>
        {p ? (
          <svg className="spark" viewBox="0 0 84 26" aria-hidden="true">
            <path className="ar" d={p.area} /><path className="ln" d={p.line} /><circle className="end" cx={p.end[0]} cy={p.end[1]} r="2.6" />
          </svg>
        ) : null}
      </div>
    </div>
  );
}

/* ============ Recharts ============ */
type Colors = { hi: string; mid: string; lo: string; soft: string; ink: string; ink2: string; grey: string; person: string };
const colors = (): Colors => ({ hi: cssVar("--accent-hi"), mid: cssVar("--accent"), lo: cssVar("--accent-lo"), soft: cssVar("--accent-soft"), ink: cssVar("--ink"), ink2: cssVar("--ink-2"), grey: "#9DB0C3", person: cssVar("--person") });
type TipProps = { active?: boolean; label?: string; payload?: { dataKey: string; color?: string; name: string; value: number | null }[] };
function Tip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="milk still tip">
      <div className="t">{label}</div>
      {payload.map((p) => (
        <div className="r" key={p.dataKey}>
          <span><i style={{ background: !String(p.color).startsWith("url") ? p.color : p.dataKey === "before" ? "#9DB0C3" : cssVar("--accent") }} />{p.name}</span>
          <b>{p.value ?? "—"}</b>
        </div>
      ))}
    </div>
  );
}
const axis = (c: Colors) => ({ tick: { fill: c.ink2, fontSize: 12 }, axisLine: { stroke: "rgba(11,42,74,.18)" }, tickLine: false });
const sw = (bg: string) => <i className="dot" style={{ background: bg }} />;

export default function Insights() {
  useAeroPage("insights");
  const { wf, helpers } = useWF();
  const rootRef = useRef<HTMLDivElement>(null);
  const ready = wf != null;
  const [themeTick, setThemeTick] = useState(0);
  const [kpiGo, setKpiGo] = useState(false);
  const [skillsGo, setSkillsGo] = useState(false);
  const [chartsShown, setChartsShown] = useState(false);
  const [chordShown, setChordShown] = useState(false);

  useEffect(() => onTheme(() => setThemeTick((t) => t + 1)), []);
  // Page-lifetime scene: bubbles + arrival toast, once.
  useEffect(() => { if (ready && rootRef.current && wf) return mount(rootRef.current, { wf }); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reveal-on-scroll triggers (the v6 onView calls).
  useEffect(() => {
    if (!ready) return;
    const q = (s: string) => rootRef.current!.querySelector(s)!;
    const offs = [onView(q("#kpis"), () => setKpiGo(true), 0.2), onView(q("#skills"), () => setSkillsGo(true)),
      onView(q("#area"), () => setChartsShown(true), 0.15), onView(q("#chord"), () => setChordShown(true), 0.15)];
    return () => offs.forEach((f) => f());
  }, [ready]);

  /* Gain radial: top five departments by hours lost, inner ring = smallest */
  const gainRef = useRef<{ play: () => void; kill: () => void } | null>(null);
  const gainPlayed = useRef(false);
  useEffect(() => {
    const svg = rootRef.current?.querySelector<SVGSVGElement>("#gain");
    if (!wf || !svg) return;
    const top5 = [...wf.byDept].sort((a, b) => b.hoursLost - a.hoursLost || b.bounces - a.bounces).slice(0, 5).reverse();
    const rows: GainRow[] = top5.map((d) => ({ name: helpers.dept(d.id)?.short ?? d.name, tag: `${d.bouncePct}% bounced`, detail: `${hrs(d.hoursLost)} h lost · ${d.bounces} bounces`, value: d.hoursLost }));
    gainRef.current?.kill();
    const h = (gainRef.current = drawGain(svg, rows, { animate: !gainPlayed.current }));
    const off = gainPlayed.current ? undefined : onView(svg, () => { gainPlayed.current = true; h.play(); });
    return () => { off?.(); };
  }, [wf, helpers]);
  useEffect(() => () => gainRef.current?.kill(), []);

  /* Chord: redraw on data or theme change, ribbons fade in the first time only */
  const chordSt = useRef({ pinned: null as number | null, animate: true });
  useEffect(() => {
    const root = rootRef.current;
    if (!wf || !chordShown || !root) return;
    const off = drawChord(root.querySelector<SVGSVGElement>("#chord")!, root.querySelector<HTMLElement>("#detail")!, wf, helpers, chordSt.current);
    chordSt.current.animate = false;
    return off;
  }, [wf, helpers, chordShown, themeTick]);

  const c = useMemo(() => (chartsShown ? colors() : null), [chartsShown, themeTick]);
  const tiles = useMemo(() => (wf ? kpis(wf) : []), [wf]);
  const skills = useMemo(() => (wf ? [...wf.byDept].sort((a, b) => b.hoursLost - a.hoursLost) : []), [wf]);
  const maxLost = Math.max(1, ...skills.map((d) => d.hoursLost));
  const barData = useMemo(() => (wf ? wf.byDept.map((d) => ({ name: helpers.dept(d.id)?.short ?? d.name, before: d.hopsBefore, after: d.hopsAfter })) : []), [wf, helpers]);

  return (
    <div ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <canvas id="bubbles" aria-hidden="true" />
      <main>
        <header className="top">
          <div>
            <h1 className="page-title" data-tour="1|Insights|Where time goes across the org, and what Wayfinder hands back, over the last 12 weeks.">Insights</h1>
            <p className="page-sub">Where time goes{wf ? ` at ${wf.company.name}` : ""}, and what Wayfinder hands back, over the last 12 weeks.</p>
          </div>
          <div className="when">
            <span className="chip info">Last 12 weeks</span>
            <span className="chip">{!wf ? "Loading…" : wf.source === "tiger" ? "● Live from Tiger Data" : "● Fixture data"}</span>
          </div>
        </header>

        <div className="grid">
          <section className="milk still card span2 title-card" aria-labelledby="kpiH" data-tour="2|At a glance|The numbers that matter. Each sparkline shows the 12-week trend.">
            <div className="bar" id="kpiH">At a glance<span className="live"><i />live</span></div>
            <div className="body"><div className="kpis" id="kpis">{tiles.map((t, i) => <Tile key={t.k} t={t} i={i} go={kpiGo} />)}</div></div>
          </section>

          <section className="milk still card" aria-labelledby="gainH" data-tour="3|Where time is lost|The departments where requests sat longest with a team that said “not us”. Each arc is one department.">
            <div className="bar" id="gainH">Where time is lost · top departments<span className="sub">hours lost</span></div>
            <div className="body">
              <div className="gain-wrap">
                <svg id="gain" viewBox="0 0 750 500" role="img" aria-label="Radial graph of hours lost to bounces by the top five departments">
                  <defs>
                    <filter id="goo" colorInterpolationFilters="sRGB">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
                      <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
                      <feBlend in="SourceGraphic" in2="goo" />
                    </filter>
                  </defs>
                  <g id="base-lines" opacity=".18" fill="none" stroke="#fff" strokeMiterlimit="10" strokeWidth="25">
                    <path d="M430.5,250A55.5,55.5,0,1,1,375,194.5" /><path d="M470.5,250A95.5,95.5,0,1,1,375,154.5" /><path d="M510.5,250A135.5,135.5,0,1,1,375,114.5" />
                    <path d="M550.5,250A175.5,175.5,0,1,1,375,74.5" /><path d="M590.5,250C590.5,369,494,465.5,375,465.5S159.5,369,159.5,250,256,34.5,375,34.5" />
                  </g>
                  <g id="mid-lines" opacity=".44" fill="none" stroke="#fff" strokeMiterlimit="10" strokeWidth="4">
                    <path d="M445,250a70,70,0,1,1-70-70" /><path d="M485,250A110,110,0,1,1,375,140" /><path d="M525,250A150,150,0,1,1,375,100" />
                    <path d="M565,250c0,104.93-85.07,190-190,190S185,354.93,185,250,270.07,60,375,60" /><path d="M605,250c0,127-103,230-230,230S145,377,145,250,248,20,375,20" />
                  </g>
                  <g id="top-lines" fill="none" stroke="#fff" strokeMiterlimit="10" strokeWidth="4" strokeLinecap="round">
                    <path className="line" d="M375,180a70,70,0,1,0,70,70" /><path className="line" d="M375,140A110,110,0,1,0,485,250" /><path className="line" d="M375,100A150,150,0,1,0,525,250" />
                    <path className="line" d="M375,60c-104.93,0-190,85.070-190,190s85.07,190,190,190,190-85.07,190-190" /><path className="line" d="M375,20C248,20,145,123,145,250S248,480,375,480,605,377,605,250" />
                  </g>
                  <g id="horz-lines" fill="none" stroke="#fff" strokeMiterlimit="10" strokeWidth="4">
                    <line x1="375" y1="180" x2="456" y2="180" /><line x1="375" y1="140" x2="456" y2="140" /><line x1="375" y1="100" x2="456" y2="100" />
                    <line x1="375" y1="60" x2="456" y2="60" /><line x1="375" y1="20" x2="456" y2="20" />
                  </g>
                  <g id="people" />
                  <g filter="url(#goo)">
                    <g id="circles" fill="#fff">
                      <circle className="circ" r="15" /><circle className="circ" r="15" /><circle className="circ" r="15" /><circle className="circ" r="15" /><circle className="circ" r="15" />
                    </g>
                    <circle id="center-circ" cx="375" cy="250" r="30.5" fill="#fff" />
                  </g>
                  <text id="gainTxt" x="375" y="255" textAnchor="middle">LOST</text>
                  <g id="vals" />
                </svg>
              </div>
              <div className="card-actions">
                <span className="muted" style={{ fontSize: 13 }}>Arc length = share of the worst department’s hours lost</span>
                <button className="pill ghost" id="replay" type="button" onClick={() => gainRef.current?.play()}>↻ Replay</button>
              </div>
            </div>
          </section>

          <section className="milk still card" aria-labelledby="skH">
            <div className="bar" id="skH">Hours lost by department<span className="sub" id="skTotal">{wf ? `${hrs(skills.reduce((n, d) => n + d.hoursLost, 0))} h total` : ""}</span></div>
            <div className="body">
              <div className={"skills" + (skillsGo ? " go" : "")} id="skills">
                {skills.map((d, i) => (
                  <div className="skill-row" role="img" aria-label={`${d.name}: ${hrs(d.hoursLost)} hours lost`} key={d.id}>
                    <span>{d.name}</span>
                    <div className="skill" style={{ "--w": `${((d.hoursLost / maxLost) * 100).toFixed(1)}%`, "--i": i } as CSSProperties}>
                      <span className="fill" /><div className="lab"><span className="h">{hrs(d.hoursLost)} h</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="milk still card" aria-labelledby="arH">
            <div className="bar" id="arH">Requests vs resolved<span className="sub">per week</span></div>
            <div className="body">
              <div className="legend" id="arLegend">{c ? <><span>{sw(c.lo)}Requests</span><span>{sw(c.person)}Resolved</span></> : null}</div>
              <div className="chart" id="area">
                {c && wf ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={wf.series} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gReq" x1={0} y1={0} x2={0} y2={1}><stop offset="0%" stopColor={c.hi} stopOpacity={0.75} /><stop offset="100%" stopColor={c.hi} stopOpacity={0.05} /></linearGradient>
                        <linearGradient id="gRes" x1={0} y1={0} x2={0} y2={1}><stop offset="0%" stopColor={c.person} stopOpacity={0.55} /><stop offset="100%" stopColor={c.person} stopOpacity={0.03} /></linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,.7)" vertical={false} />
                      <XAxis dataKey="week" {...axis(c)} /><YAxis {...axis(c)} allowDecimals={false} />
                      <Tooltip content={<Tip />} cursor={{ stroke: "rgba(255,255,255,.9)", strokeWidth: 2 }} />
                      <Area type="monotone" dataKey="requests" name="Requests" stroke={c.lo} strokeWidth={2.4} fill="url(#gReq)" isAnimationActive={!RM} animationDuration={1400} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
                      <Area type="monotone" dataKey="resolved" name="Resolved" stroke={c.person} strokeWidth={2.4} fill="url(#gRes)" isAnimationActive={!RM} animationDuration={1400} animationBegin={200} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
          </section>

          <section className="milk still card" aria-labelledby="brH" data-tour="4|Fewer hops|How many people a request bounced through before Wayfinder. The “after” bars fill in as live requests resolve.">
            <div className="bar" id="brH">Hops before vs after Wayfinder<span className="sub">avg per request</span></div>
            <div className="body">
              <div className="legend" id="brLegend">{c ? <><span>{sw("#9DB0C3")}Before</span><span>{sw(`linear-gradient(${c.hi},${c.lo})`)}With Wayfinder · live</span></> : null}</div>
              <div className="chart" id="bars">
                {c && wf ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barGap={3}>
                      <defs>
                        <linearGradient id="gAfter" x1={0} y1={0} x2={0} y2={1}><stop offset="0%" stopColor={c.hi} /><stop offset="100%" stopColor={c.lo} /></linearGradient>
                        <linearGradient id="gBefore" x1={0} y1={0} x2={0} y2={1}><stop offset="0%" stopColor="#C3D1DE" /><stop offset="100%" stopColor="#8CA0B4" /></linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,.7)" vertical={false} />
                      <XAxis dataKey="name" {...axis(c)} interval={0} tick={{ fill: c.ink2, fontSize: 11 }} /><YAxis {...axis(c)} />
                      <Tooltip content={<Tip />} cursor={{ fill: "rgba(255,255,255,.35)" }} />
                      <Bar dataKey="before" name="Before" fill="url(#gBefore)" radius={[6, 6, 0, 0]} isAnimationActive={!RM} animationDuration={1100} />
                      <Bar dataKey="after" name="With Wayfinder" fill="url(#gAfter)" radius={[6, 6, 0, 0]} isAnimationActive={!RM} animationDuration={1100} animationBegin={250} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
          </section>

          <section className="milk still card span2" aria-labelledby="chH" data-tour="5|Where requests flow|Who sends work to whom. Hover a department to isolate its routes.">
            <div className="bar" id="chH">Where requests flow<span className="sub">department → department hand-offs</span></div>
            <div className="body">
              <div className="chord-grid">
                <svg id="chord" viewBox="-310 -300 620 600" role="img" aria-label="Chord diagram of request routing between departments" />
                <div className="detail" id="detail" aria-live="polite" />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
