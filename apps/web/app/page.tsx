"use client";
// Home Tree: port of docs/design/v6/index.html (v7 hero). The globe scene mounts once (app/home/scene.ts);
// the stat pins are React so live refreshes update their numbers in place.

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { WfStats } from "@wayfinder/shared";
import { useAeroPage } from "@/lib/aero/usePage";
import { useWF } from "@/lib/wf/store";
import { css } from "./home/style";
import { PIN_SPECS, mount } from "./home/scene";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const hrs = (n: number) => (n < 100 ? (Math.round(n * 10) / 10).toLocaleString("en-US") : fmt(n));

/** Pin text in PIN_SPECS order. Only real numbers; parts with no data yet are left out. */
function pinText(S: WfStats): { v: string; l: string; chip?: string }[] {
  return [
    { v: hrs(S.hoursLost), l: "hours lost to “not us”", chip: `${hrs(S.hoursSaved)} h saved` },
    { v: fmt(S.peopleHelped), l: "people helped" },
    { v: `${S.departments}`, l: `departments · ${S.subDepartments} teams` },
    { v: fmt(S.requestsRouted), l: "requests routed" },
    S.avgHopsAfter != null
      ? { v: `${S.avgHopsBefore} → ${S.avgHopsAfter}`, l: "avg hops per request", chip: S.medianResolve ? `${S.medianBefore} → ${S.medianResolve}` : undefined }
      : { v: `${S.avgHopsBefore}`, l: "avg hops per request, before" },
  ];
}

export default function Home() {
  useAeroPage("home", { tourDelay: 8200 });
  const { wf } = useWF();
  const rootRef = useRef<HTMLDivElement>(null);
  const ready = wf != null;

  // Mount the globe once the pins exist; it never rebuilds on a data refresh.
  useEffect(() => {
    if (!ready || !rootRef.current) return;
    return mount(rootRef.current);
  }, [ready]);

  const pins = wf ? pinText(wf.stats) : [];

  return (
    <div ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div id="sky" aria-hidden="true">
        <div className="sun" />
        <svg viewBox="0 0 1440 900" preserveAspectRatio="none">
          <path className="rib" d="M-40 300 C 300 180, 700 420, 1500 220" strokeWidth="22" strokeOpacity=".22" />
          <path className="rib" d="M-40 360 C 380 260, 760 470, 1500 300" strokeWidth="6" strokeOpacity=".35" />
          <path className="rib" d="M-40 640 C 420 560, 900 760, 1500 600" strokeWidth="30" strokeOpacity=".12" />
        </svg>
        <div className="haze" />
      </div>
      <canvas id="globe" aria-label="Wayfinder globe: a sphere of glass cubes showing what Wayfinder has done" />
      <svg id="leaders" aria-hidden="true" />
      <div id="pins" aria-live="polite">
        {pins.map((p, k) => (
          <div key={k} className={"pin" + (PIN_SPECS[k].m ? " m-hide" : "")}>
            <div className="lbl">
              <span className="v"><i className="dot" />{p.v}</span>
              <span className="l">{p.l}</span>
              {p.chip ? <span className="chip">{p.chip}</span> : null}
            </div>
          </div>
        ))}
      </div>
      <div id="globeSpot" aria-hidden="true" data-tour="2|The globe|Every cube stands for work Wayfinder routes. The pins show the real numbers: hours lost to bounces, people helped, hops per request." />

      <div id="heroWrap">
        <section id="hero" className="milk still title-card">
          <div className="bar"><span className="logo-orb" />Home Tree</div>
          <div className="body">
            <h1 className="page-title reveal" data-tour="1|Wayfinder|An AI coordinator you text. Tell it a goal and it finds the people, resources and approvals to make it happen.">Wayfinder</h1>
            <p className="tag reveal"><b>Discover.</b> <b>Connect.</b> <b>Coordinate.</b> <b>Evolve.</b></p>
            <p className="page-sub reveal">Tell it a goal. It finds the people who can make it happen.</p>
            <div className="ctas reveal" data-tour="3|Start here|Roots shows your organisation as a living network. Insights shows where time goes and what Wayfinder hands back.">
              <Link className="pill" href="/roots">Explore the Roots</Link>
              <Link className="pill ghost" href="/insights">See the Insights</Link>
            </div>
            <div className="eng" data-tour="4|Three engines|Coordinate routes each step to its real owner. Discover introduces people with overlapping work. Evolve learns shorter routes over time.">
              <article className="milk reveal"><h3 className="band green">Coordinate</h3><div className="in"><p>Breaks a goal into steps and sends each to its real owner.</p></div></article>
              <article className="milk reveal"><h3 className="band pink">Discover</h3><div className="in"><p>Mycelium matches needs and skills, then introduces people.</p></div></article>
              <article className="milk reveal"><h3 className="band amber">Evolve</h3><div className="in"><p>Darwin replays past requests and evolves shorter routes.</p></div></article>
            </div>
          </div>
        </section>
      </div>

      <button id="skip" className="pill ghost" type="button">Skip intro</button>
      <div className="err" id="err">This scene needs WebGL.</div>
    </div>
  );
}
