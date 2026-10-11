"use client";
// Darwin Growth. Port of docs/design/v6/darwin.html, read-only over a Darwin run snapshot.

import { useEffect, useMemo, useRef } from "react";
import { useAeroPage } from "@/lib/aero/usePage";
import { useWF } from "@/lib/wf/store";
import type { DarwinMeta } from "@/lib/wf/darwin";
import { STYLE } from "./style";
import { mount, sampleGenerations } from "./scene";

export default function Darwin({ meta }: { meta: DarwinMeta | null }) {
  useAeroPage("darwin");
  const { wf, error } = useWF();
  const root = useRef<HTMLDivElement>(null);
  const all = wf?.darwin ?? [];
  const gens = useMemo(() => sampleGenerations(all), [all]);
  const rules = wf?.rules ?? [];
  const has = gens.length > 0;
  const key = has ? JSON.stringify([gens, rules]) : "";

  useEffect(() => {
    if (!key || !root.current) return;
    return mount(root.current, { gens, totalGens: all.length, rules, replayed: meta?.replayed ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const base = all[0]?.avgHops, best = all.at(-1)?.avgHops;
  const fall = has && base !== undefined && best !== undefined ? ` Average hops fall from ${base.toFixed(2)} to ${best.toFixed(2)} (projected).` : "";
  const replayed = meta?.replayed ? `${meta.replayed.toLocaleString()} ` : "";
  const empty = error ? `Couldn't load data: ${error}` : !wf ? "Loading…" : "No Darwin run yet. Run services/darwin/fixtures_run.py to capture one.";

  return (
    <div ref={root}>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div id="stage"><canvas id="tree" aria-label="Darwin's evolution tree: each ring of branches is a generation, each orange fruit is an evolved routing rule"></canvas></div>

      <section id="head" className="milk float title-card" aria-live="polite" data-tour="1|Darwin Growth|Darwin replays past requests and keeps the routes that need fewer hops. It is Wayfinder improving itself.">
        <div className="bar"><span className="logo-orb"></span>Evolve<span className="live"><i id="liveDot"></i><span id="liveTxt">{has ? "evolving" : "idle"}</span></span></div>
        <div className="body">
          <h1 className="page-title">Darwin Growth</h1>
          <div className="now"><span className="g" id="genN">Gen 0</span> · <b id="genH">–</b> avg hops</div>
          <div className="more"><div>
            <p className="page-sub">Darwin replays {replayed ? `${replayed}past` : "past"} requests and breeds shorter routes. Every ring of branches is a generation, and every orange fruit is a rule it learned.</p>
            <div className="from" id="genFrom">{has ? "" : empty}</div>
          </div></div>
          <div className="acts">
            <button className="pill" id="regrow" disabled={!has}>↻ Regrow</button>
            <span className="chip info" id="ruleCount">0 rules</span>
            {wf?.darwinSource === "snapshot" && <span className="chip warn" title={meta?.runId ?? "Darwin run snapshot"}>snapshot</span>}
          </div>
        </div>
      </section>

      <section id="gens" className="milk float" data-tour={`3|Generations|Each generation replays the same ${replayed}requests.${fall}`}>
        <div className="bar">Generations<span className="live"><i></i>replay</span></div>
        <div className="body">
          <div className="rows" id="genRows">{!has && <p className="foot">{empty}</p>}</div>
          <p className="foot">
            Fitness is Darwin&apos;s replay cost (hours + hops + 2 × bounces + 2 per rule), scaled so 0 is history as it happened and 1 is the best rule set found. Hops are projected from fitness.
            {all.length > gens.length ? ` Showing ${gens.length} of ${all.length} generations: the start, every improvement, and the last.` : ""}
          </p>
        </div>
      </section>

      <div id="tip" className="lbl off"><i></i><span></span></div>

      <section id="rule" className="milk float still" role="dialog" aria-label="Evolved rule">
        <div className="bar"><span id="rGen">Rule</span><button className="x" id="rClose" aria-label="Close">×</button></div>
        <div className="body">
          <div className="k">Evolved routing rule</div>
          <p className="txt" id="rTxt"></p>
          <div className="meta"><span className="chip" id="rSaves"></span><span className="chip" id="rStatus"></span></div>
          <div className="acts">
            <button className="pill green" id="rOk" disabled style={{ opacity: 0.55 }} title="Live approval coming soon">Approve</button>
            <button className="pill ghost" id="rNo" disabled style={{ opacity: 0.55 }} title="Live approval coming soon">Reject</button>
          </div>
          <p id="rNote" style={{ margin: "10px 0 0", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.4 }}>Live approval coming soon.</p>
        </div>
      </section>
    </div>
  );
}
