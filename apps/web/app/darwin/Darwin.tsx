"use client";
// Darwin Growth. Port of docs/design/v6/darwin.html. Live when the agent reaches Darwin
// (GET /api/agent/darwin): every generation is a fruit an admin can approve or reject. Otherwise
// it renders the Darwin run snapshot read-only. Refetches after a decision and whenever
// lib/wf/live.tsx sees a darwin_generation_* event ("wf:darwin").

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DarwinView, WfGeneration } from "@wayfinder/shared";
import { toast } from "@/lib/aero/runtime";
import { useAeroPage } from "@/lib/aero/usePage";
import { useLiveStatus } from "@/lib/wf/live";
import { useWF } from "@/lib/wf/store";
import type { DarwinMeta } from "@/lib/wf/darwin";
import { STYLE } from "./style";
import { mount, sampleGenerations, type Action, type Scene } from "./scene";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const connected = (v: DarwinView | null) => (v?.connected && v.generations.length ? v : null);

export default function Darwin({ meta, initial }: { meta: DarwinMeta | null; initial: DarwinView | null }) {
  useAeroPage("darwin");
  const { wf, error } = useWF();
  const root = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [live, setLiveView] = useState<DarwinView | null>(connected(initial));
  const sse = useLiveStatus();
  const sseRef = useRef(sse);
  sseRef.current = sse;

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/darwin", { cache: "no-store" });
      if (res.ok) setLiveView(connected((await res.json()) as DarwinView));
    } catch { /* keep what we have */ }
  }, []);

  useEffect(() => {
    const on = () => void refetch();
    window.addEventListener("wf:darwin", on);
    if (!initial) void refetch(); // the server couldn't reach the agent; try once from here
    return () => window.removeEventListener("wf:darwin", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch]);

  const decide = useCallback(async (gen: number, action: Action) => {
    let out: { ok?: boolean; error?: string; rules?: unknown[] } = {};
    try {
      const res = await fetch(`/api/agent/darwin/${gen}/${action}`, { method: "POST" });
      out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
    } catch (err) {
      toast("evo", "Not saved", `Generation ${gen}`, esc(err instanceof Error ? err.message : String(err)));
      throw err;
    }
    // With the live stream connected, live.tsx toasts the event for every open tab, this one included.
    if (sseRef.current !== "live") toast("evo", `Generation ${gen} ${action === "approve" ? "approved" : "rejected"}`, "Saved as an event", action === "approve" ? "The agent now routes by its rules" : "It fell from the tree");
    void refetch();
  }, [refetch]);

  const all: WfGeneration[] = live ? live.generations : wf?.darwin ?? [];
  const gens = useMemo(() => sampleGenerations(all), [all]);
  const rules = wf?.rules ?? [];
  const has = gens.length > 0;
  // Rebuild the scene when the run changes, not when a status does (apply() moves the fruit instead).
  const key = !has ? "" : live
    ? JSON.stringify(["live", live.generations.map((g) => [g.gen, g.ruleIds, g.avgHops])])
    : JSON.stringify(["snapshot", gens, rules]);

  useEffect(() => {
    if (!key || !root.current) return;
    const s = mount(root.current, {
      gens, totalGens: all.length, rules, replayed: live?.replayed ?? meta?.replayed ?? null,
      ...(live ? { live: { generations: live.generations, decide } } : {}),
    });
    scene.current = s;
    return () => { s.destroy(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { if (live) scene.current?.apply(live.generations); }, [live]);

  const base = all[0]?.avgHops, best = all.at(-1)?.avgHops;
  const fall = has && base !== undefined && best !== undefined ? ` Average hops fall from ${base.toFixed(2)} to ${best.toFixed(2)}${live ? "" : " (projected)"}.` : "";
  const n = live?.replayed ?? meta?.replayed;
  const replayed = n ? `${n.toLocaleString()} ` : "";
  const empty = error ? `Couldn't load data: ${error}` : !wf ? "Loading…" : "No Darwin run yet. Start services/darwin, or run services/darwin/fixtures_run.py to capture one.";

  return (
    <div ref={root}>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div id="stage"><canvas id="tree" aria-label={live ? "Darwin's evolution tree: each ring of branches is a generation, each orange fruit is that generation's best rule set" : "Darwin's evolution tree: each ring of branches is a generation, each orange fruit is an evolved routing rule"}></canvas></div>

      <section id="head" className="milk float title-card" aria-live="polite" data-tour="1|Darwin Growth|Darwin replays past requests and keeps the routes that need fewer hops. It is AVATAR improving itself.">
        <div className="bar"><span className="logo-orb"></span>Evolve<span className="live"><i id="liveDot"></i><span id="liveTxt">{has ? "evolving" : "idle"}</span></span></div>
        <div className="body">
          <h1 className="page-title">Darwin Growth</h1>
          <div className="now"><span className="g" id="genN">Gen 0</span> · <b id="genH">–</b> avg hops</div>
          <div className="more"><div>
            <p className="page-sub">
              Darwin replays {replayed ? `${replayed}past` : "past"} requests and breeds shorter routes. Every ring of branches is a generation, and every orange fruit is {live ? "that generation's best rule set. Approve a fruit and the agent routes by it; reject it and it falls." : "a rule it learned."}
            </p>
            <div className="from" id="genFrom">{has ? "" : empty}</div>
          </div></div>
          <div className="acts">
            <button className="pill" id="regrow" disabled={!has}>↻ Regrow</button>
            <span className="chip info" id="ruleCount">0 rules</span>
            {live
              ? <span className="chip" title="Connected to Darwin through the agent: decisions are saved as events and pushed to Darwin">live</span>
              : wf?.darwinSource === "snapshot" && <span className="chip warn" title={meta?.runId ?? "Darwin run snapshot"}>snapshot</span>}
          </div>
        </div>
      </section>

      <section id="gens" className="milk float" data-tour={`3|Generations|Each generation replays the same ${replayed}requests${live ? " with its best rules" : ""}.${fall}`}>
        <div className="bar">Generations<span className="live"><i></i>replay</span></div>
        <div className="body">
          <div className="rows" id="genRows">{!has && <p className="foot">{empty}</p>}</div>
          <p className="foot">
            {live
              ? "Fitness is how much of Darwin's best improvement (hours, hops and \"not us\" bounces on replay) each generation reached. Hops are Darwin's replay with that generation's rules. Click a row or its fruit to approve or reject it."
              : "Fitness is Darwin's replay cost (hours + hops + 2 × bounces + 2 per rule), scaled so 0 is history as it happened and 1 is the best rule set found. Hops are projected from fitness."}
            {!live && all.length > gens.length ? ` Showing ${gens.length} of ${all.length} generations: the start, every improvement, and the last.` : ""}
          </p>
        </div>
      </section>

      <div id="tip" className="lbl off"><i></i><span></span></div>

      <section id="rule" className="milk float still" role="dialog" aria-label={live ? "Generation" : "Evolved rule"}>
        <div className="bar"><span id="rGen">Rule</span><button className="x" id="rClose" aria-label="Close">×</button></div>
        <div className="body">
          <div className="k" id="rKind">Evolved routing rule</div>
          <p className="txt" id="rTxt"></p>
          <ul className="rl" id="rList"></ul>
          <div className="meta"><span className="chip" id="rSaves"></span><span className="chip" id="rStatus"></span></div>
          <div className="acts">
            <button className="pill green" id="rOk" disabled style={{ opacity: 0.55 }}>Approve</button>
            <button className="pill ghost" id="rNo" disabled style={{ opacity: 0.55 }}>Reject</button>
          </div>
          <p id="rNote" style={{ margin: "10px 0 0", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.4 }}></p>
        </div>
      </section>
    </div>
  );
}
