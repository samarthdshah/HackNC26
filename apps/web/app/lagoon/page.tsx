"use client";
// Lagoon (docs/design/v6/lagoon.html): people working on the same thing as you.
// The ocean, jellyfish, topic bubbles and drawer are mounted by scene.ts once the WF snapshot
// loads; later snapshots are diffed into the scene so topics and intro counts stay live.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { WF } from "@wayfinder/shared";
import { useAeroPage } from "@/lib/aero/usePage";
import { useWF } from "@/lib/wf/store";
import { css, JELLY } from "./style";
import type { LagoonApi } from "./scene";

const RAYS: [number, number, number][] = [[8, 9, -14], [24, 6, -6], [41, 11, 3], [58, 7, 9], [74, 10, 15], [90, 6, 20]];
const FILTERS = [["all", "All"], ["query", "Queries"], ["resource", "Resources"], ["team", "Teammates"]] as const;

export default function LagoonPage() {
  useAeroPage("lagoon");
  const { wf, version, refresh } = useWF();
  const [filter, setFilter] = useState<string>("all");
  const rootRef = useRef<HTMLDivElement>(null);
  const api = useRef<LagoonApi | null>(null);
  const wfRef = useRef<WF | null>(wf);
  wfRef.current = wf;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const loaded = !!wf;

  useEffect(() => {
    if (!loaded || !rootRef.current) return;
    let alive = true;
    let local: LagoonApi | null = null;
    import("./scene").then(({ mount }) => {
      if (!alive || !rootRef.current || !wfRef.current) return;
      try { local = api.current = mount(rootRef.current, wfRef.current, { refresh: () => refreshRef.current() }); } catch (e) { console.error(e); }
    });
    return () => { alive = false; local?.cleanup(); api.current = null; };
  }, [loaded]);

  useEffect(() => { if (wf) api.current?.update(wf); }, [version, wf]);

  const pick = (f: string) => { setFilter(f); api.current?.setFilter(f); };
  const me = wf?.me;
  const topics = wf ? wf.topics.filter((t) => t.ids.some((id) => id !== wf.me.id)) : [];
  const people = new Set(topics.flatMap((t) => t.ids.filter((id) => id !== me?.id)));

  return (
    <div ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div id="sea" aria-hidden="true" />
      <div id="ocean" aria-hidden="true" />
      <div id="rays" aria-hidden="true">
        {RAYS.map(([l, w, r], i) => (
          <i key={i} style={{ left: l + "%", width: w + "vw", animationDelay: -i * 2.3 + "s", "--r": r + "deg" } as CSSProperties} />
        ))}
      </div>
      <div id="surface" aria-hidden="true" />

      <svg id="links" aria-hidden="true">
        <defs>
          <linearGradient id="linkGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--c-secondary)" }} />
            <stop offset=".55" style={{ stopColor: "#e8fbff" }} />
            <stop offset="1" style={{ stopColor: "var(--c-warm)" }} />
          </linearGradient>
          <filter id="linkBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
          <filter id="pulseGlow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
      </svg>

      <section id="intro" className="milk float still title-card" data-tour="1|Lagoon|Wayfinder notices when other people are working on the same thing you are, so you can team up instead of starting from scratch.">
        <div className="bar"><span className="logo-orb" />Discovery garden<span className="live"><i />Mycelium</span></div>
        <div className="body">
          <h1 className="page-title">Lagoon</h1>
          <p className="page-sub">People working on the same thing as you.</p>
          <div className="more"><div>
            <p className="page-sub" style={{ fontSize: 14 }}>Mycelium reads the questions people send Wayfinder and spots overlap. Each bubble is a topic you share; bigger bubbles hold more people. Nobody is introduced until you tap Introduce.</p>
            <div className="stats">
              <span className="chip" id="nSeeds">{wf ? `${topics.length} ${topics.length === 1 ? "topic" : "topics"} · ${people.size} ${people.size === 1 ? "person" : "people"}` : "…"}</span>
              <span className="chip info" id="nIntros">{wf ? `${wf.stats.introsMade} ${wf.stats.introsMade === 1 ? "intro" : "intros"} made` : "…"}</span>
            </div>
            <div className="seg" role="group" aria-label="Filter topics" data-tour="2|Filter|Show only shared questions, spare resources, or teammates.">
              {FILTERS.map(([f, label]) => <button key={f} data-f={f} aria-pressed={filter === f} onClick={() => pick(f)}>{label}</button>)}
            </div>
          </div></div>
        </div>
      </section>

      <div id="jelly" data-tour="3|That’s you|The jellyfish in the middle is you. Each glowing tentacle reaches a topic you share with other people.">
        <svg id="jfSvg" xmlns="http://www.w3.org/2000/svg" viewBox="95 125 340 320" aria-label="You, as a jellyfish" dangerouslySetInnerHTML={{ __html: JELLY }} />
        <div className="you">
          <span className="lbl"><i style={{ background: "var(--c-warm)" }} />You · <span id="meName">{me?.name ?? ""}</span></span>
          {wf && !topics.length && <span className="lbl person" id="lagoonEmpty">No shared topics yet. Text Wayfinder and Mycelium will spot overlap.</span>}
          <button className="pill ghost" id="moreTopics" hidden data-tour="5|More topics|Only your five strongest topics float in the lagoon, so it never gets crowded. The rest are tucked in here." />
        </div>
      </div>

      <div id="seeds" />
      <aside id="drawer" className="milk float still" aria-label="People in this topic" aria-hidden="true">
        <div className="bar"><span id="dTitle">Topic</span><button className="x" id="dClose" aria-label="Close">×</button></div>
        <div className="body" id="dBody" />
      </aside>
      <div className="err" id="err">The ocean needs WebGL. Your topics still work.</div>
    </div>
  );
}
