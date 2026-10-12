"use client";
// Insights: port of docs/design/v6/insights.html, trimmed to KPIs, the gain radial and the chord.
// The numbers are React (they re-render on every WF refresh); bubbles, the radial and the chord live in scene.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import type { WF } from "@wayfinder/shared";
import { useAeroPage } from "@/lib/aero/usePage";
import { useWF } from "@/lib/wf/store";
import { RM, onTheme } from "@/lib/aero/runtime";
import { css } from "./style";
import { drawChord, drawGain, fmt, hrs, mount, onView, type GainRow } from "./scene";

/* ============ KPI tiles ============ */
type Kpi = { k: string; to: number; from?: number; f: (v: number) => string; pre?: string; suf?: string; spark?: number[]; chip: string; cls?: string };

const mins = (v: number) => {
  const h = Math.floor(v / 60);
  return h >= 48 ? `${(v / 1440).toFixed(1)} d` : h ? `${h} h ${Math.round(v % 60)} m` : `${Math.max(1, Math.round(v))} m`;
};

/** Hours lost and saved are summed from the 12-week series so each number matches its sparkline
 *  and the "Last 12 weeks" chip. Hops and median compare seeded history with live AVATAR requests. */
function kpis(wf: WF): Kpi[] {
  const S = wf.stats, ser = wf.series;
  const total = (k: "hoursLost" | "hoursSaved") => ser.reduce((n, d) => n + d[k], 0);
  const after = S.medianResolveMs;
  return [
    { k: "Hours lost", to: total("hoursLost"), f: hrs, suf: "h", spark: ser.map((d) => d.hoursLost), chip: "“not us” replies" },
    { k: "Hours saved", to: total("hoursSaved"), f: hrs, suf: "h", spark: ser.map((d) => d.hoursSaved), chip: "live vs usual time", cls: "info" },
    S.avgHopsAfter != null
      ? { k: "Avg hops", from: S.avgHopsBefore, to: S.avgHopsAfter, f: (v) => v.toFixed(1), pre: `${S.avgHopsBefore} → `, spark: ser.map((d) => d.hops),
          chip: `−${Math.round((1 - S.avgHopsAfter / (S.avgHopsBefore || 1)) * 100)}%` }
      : { k: "Avg hops", to: S.avgHopsBefore, f: (v) => v.toFixed(1), spark: ser.map((d) => d.hops), chip: "after: live" },
    after != null
      ? { k: "Median resolve", to: after / 60000, f: mins, chip: `was ${S.medianBefore}` }
      : { k: "Median resolve", to: S.medianBeforeMs / 60000, f: mins, chip: "before AVATAR" },
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

export default function Insights() {
  useAeroPage("insights");
  const { wf, helpers } = useWF();
  const rootRef = useRef<HTMLDivElement>(null);
  const ready = wf != null;
  const [themeTick, setThemeTick] = useState(0);
  const [kpiGo, setKpiGo] = useState(false);
  const [chordShown, setChordShown] = useState(false);

  useEffect(() => onTheme(() => setThemeTick((t) => t + 1)), []);
  // Page-lifetime scene: bubbles + arrival toast, once.
  useEffect(() => { if (ready && rootRef.current && wf) return mount(rootRef.current, { wf }); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reveal-on-scroll triggers (the v6 onView calls).
  useEffect(() => {
    if (!ready) return;
    const q = (s: string) => rootRef.current!.querySelector(s)!;
    const offs = [onView(q("#kpis"), () => setKpiGo(true), 0.2), onView(q("#chord"), () => setChordShown(true), 0.15)];
    return () => offs.forEach((f) => f());
  }, [ready]);

  /* Gain radial: top five departments with any hours lost, inner ring = smallest */
  const gainRef = useRef<{ play: () => void; kill: () => void } | null>(null);
  const gainPlayed = useRef(false);
  useEffect(() => {
    const svg = rootRef.current?.querySelector<SVGSVGElement>("#gain");
    if (!wf || !svg) return;
    const top5 = [...wf.byDept].filter((d) => d.hoursLost > 0)
      .sort((a, b) => b.hoursLost - a.hoursLost || b.bounces - a.bounces).slice(0, 5).reverse();
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

  const tiles = useMemo(() => (wf ? kpis(wf) : []), [wf]);

  return (
    <div ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <canvas id="bubbles" aria-hidden="true" />
      <main>
        <header className="top">
          <div>
            <h1 className="page-title" data-tour="1|Insights|Where time goes across the org, and what AVATAR hands back, over the last 12 weeks.">Insights</h1>
            <p className="page-sub">Where time goes{wf ? ` at ${wf.company.name}` : ""}, and what AVATAR hands back, over the last 12 weeks.</p>
          </div>
          <div className="when">
            <span className="chip info">Last 12 weeks</span>
            <span className="chip">{!wf ? "Loading…" : wf.source === "tiger" ? "● Live from Tiger Data" : "● Fixture data"}</span>
          </div>
        </header>

        <div className="grid">
          <section className="milk still card title-card kpi-card" aria-labelledby="kpiH" data-tour="2|At a glance|The numbers that matter. Each sparkline shows the 12-week trend; the after numbers come from live AVATAR requests.">
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

          <section className="milk still card span2" aria-labelledby="chH" data-tour="4|Where requests flow|Who sends work to whom. Hover a department to isolate its routes.">
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
