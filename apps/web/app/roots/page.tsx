"use client";
// Roots (docs/design/v6/roots.html): the org as a glass mycelium network, plus "your requests".
// The three.js scene lives in scene.ts and mounts once the WF snapshot has loaded; the request
// list is React so live refreshes show up, and hovering a row plays its real hop chain on the map.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WF, WfQuery } from "@wayfinder/shared";
import { useAeroPage } from "@/lib/aero/usePage";
import { useWF, type WFHelpers } from "@/lib/wf/store";
import { duration } from "@/lib/wf/format";
import { css } from "./style";
import type { RootsApi } from "./scene";

type Filter = "active" | "done"; // v7: Active / Past only

// Plain-language status: who has it now, and how long it has been open.
function status(q: WfQuery, h: WFHelpers, now: number) {
  const last = q.hops.at(-1);
  const who = last ? h.nameOf(last.who) : "AVATAR";
  const open = q.status === "active" ? duration(now - new Date(q.startedIso).getTime()) : q.elapsed;
  if (q.status === "done") return { chip: "Done", cls: "", line: `Done · took ${q.elapsed}` };
  if (!last || last.verdict === "pending") return { chip: "Waiting", cls: "warn", line: `Waiting on ${who} · ${open}` };
  return { chip: "With owner", cls: "info", line: `With ${who} · ${open}` };
}

export default function RootsPage() {
  useAeroPage("roots");
  const { wf, version, helpers } = useWF();
  const [filter, setFilter] = useState<Filter>("active");
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const api = useRef<RootsApi | null>(null);
  const loaded = !!wf;

  // Elapsed times tick while requests are open.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30e3); return () => clearInterval(t); }, []);

  // Mount the scene once, after the first snapshot arrives.
  const wfRef = useRef<WF | null>(wf);
  wfRef.current = wf;
  useEffect(() => {
    if (!loaded || !rootRef.current) return;
    let alive = true;
    let local: RootsApi | null = null;
    import("./scene").then(({ mount }) => {
      if (!alive || !rootRef.current || !wfRef.current) return;
      try { local = api.current = mount(rootRef.current, wfRef.current); } catch (e) { console.error(e); }
    });
    return () => { alive = false; local?.cleanup(); api.current = null; };
  }, [loaded]);

  // Later snapshots: hand them to the scene (it rebuilds only if the org or routing changed).
  useEffect(() => { if (wf) api.current?.update(wf); }, [version, wf]);

  const mine = wf?.queries ?? [];
  const nActive = mine.filter((q) => q.status === "active").length;
  const list = mine.filter((q) => q.status === filter);
  const empty = !wf ? "Loading…" : !mine.length ? "Nothing yet. Text AVATAR to start." : "Nothing here yet.";
  const play = (id: string) => api.current?.playQuery(id);

  return (
    <div ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <canvas id="scene" aria-label="AVATAR org as a glass mycelium network: departments, teams and people" />

      <section id="mine" className="milk float title-card" aria-label="Roots: your requests"
        data-tour="1|Your requests|Everything you've asked AVATAR lives here: what's still moving and what's finished.">
        <div className="bar"><span className="logo-orb" /><span className="live"><i />live</span></div>
        <div className="body">
          <div>
            <h1 className="page-title">Roots</h1>
            <div className="more"><div><p className="page-sub" style={{ marginTop: 4 }}>The org as a living network. Big bubbles are departments, then teams, then people. Click a department to go inside.</p></div></div>
          </div>
          <div className="who">
            <span className="orb" id="meOrb">{wf?.me.first[0] ?? ""}</span>
            <div><div className="t" id="meName">{wf?.me.name}</div><div className="s" id="meDept">{wf ? `${wf.me.deptName} · ${wf.me.subName}` : ""}</div></div>
            <span className="chip warn" id="activeChip">{wf ? `${nActive} active ${nActive === 1 ? "chat" : "chats"}` : ""}</span>
          </div>
          <div className="seg" role="group" aria-label="Filter queries"
            data-tour="2|Active and past|Switch between requests still in flight and ones already resolved.">
            {(["active", "done"] as const).map((f) => (
              <button key={f} data-f={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "active" ? "Active" : "Past"}</button>
            ))}
          </div>
          <div className="rows" id="qlist">
            {list.length ? list.map((q, ix) => {
              const st = status(q, helpers, now);
              return (
                <Link key={q.id} className="row" data-q={q.id} href={`/currents?q=${encodeURIComponent(q.id)}`}
                  onMouseEnter={() => play(q.id)} onFocus={() => play(q.id)}
                  {...(ix === 0 ? { "data-tour": "3|One request|Who has it now and how long it has been open. Hover to watch it travel the map; click to open every hop in Currents." } : {})}>
                  <div className="mid"><div className="t">{q.title}</div>
                    <div className="meta"><span className={`chip ${st.cls}`}>{st.chip}</span><span className="s">{st.line}</span></div></div>
                  <span className="go" aria-hidden="true">›</span>
                </Link>
              );
            }) : <div className="empty">{empty}</div>}
          </div>
          <div className="more"><div><p className="page-sub" style={{ fontSize: 12 }}>Each row says who has it now and how long it has been open. Open one to see every hop in Currents.</p></div></div>
        </div>
      </section>

      <div id="legend" aria-label="Legend" data-tour="5|Reading the map|Bubble size is rank. Green dots are a request moving; pink dots are Mycelium introducing two people.">
        <span className="opt"><i className="dot l" style={{ background: "radial-gradient(circle at 35% 30%,#fff,#5BD86B 50%,#1F8F37)" }} />AVATAR</span>
        <span><i className="dot l" id="lg-dept" />Department</span>
        <span><i className="dot m" id="lg-sub" />Team</span>
        <span><i className="dot s" id="lg-person" />Person</span>
        <span><i className="flat" style={{ background: "#1F9A3A" }} />Request</span>
        <span className="opt"><i className="flat" id="lg-match" />Match</span>
        <span className="opt n" id="counts" />
      </div>
      <div id="graphZone" aria-hidden="true" style={{ position: "fixed", pointerEvents: "none", zIndex: 1 }}
        data-tour="4|The org underneath|Departments, teams and people. Click a big bubble to zoom into that department; Esc or ← All departments comes back." />

      <div id="focusbar"><button className="pill ghost" id="back">← All departments</button><span className="lbl" id="ftitle" /></div>
      <div className="err" id="err">This scene needs WebGL to draw the org.</div>
    </div>
  );
}
