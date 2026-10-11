"use client";
// Currents: one query, end to end. Port of docs/design/v6/currents.html.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { SayResponse, SummaryRequest, SummaryResponse, TxKind, WfQuery, WfTx } from "@wayfinder/shared";
import { useAeroPage } from "@/lib/aero/usePage";
import { hideToast, toast } from "@/lib/aero/runtime";
import { speakLine, stopVoice, unlockVoice } from "@/lib/aero/voice";
import { useWF } from "@/lib/wf/store";
import { clock, duration } from "@/lib/wf/format";
import { STYLE } from "./style";
import { playFlow, renderMini } from "./scene";

const KIND: Record<TxKind, [string, string] | null> = {
  route: ["info", "routed"], learn: ["", "learned"], approve: ["", "approved"], deny: ["bad", "declined"],
  pay: ["warn", "payment"], pending: ["warn", "pending"], msg: null, you: null,
};
const ORBS = ["blue", "amber", "pink", "grey"];
const hash = (s: string) => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);

type Row = Pick<WfTx, "t" | "from" | "kind" | "text"> & { id: string; fresh?: boolean; sys?: boolean };

function statusChip(q: WfQuery): [string, string] {
  if (q.rawStatus === "denied") return ["chip bad", "Denied"];
  if (q.rawStatus === "stuck") return ["chip bad", "Stuck"];
  return q.status === "done" ? ["chip", "Resolved"] : ["chip warn", "In progress"];
}

export default function Currents() {
  useAeroPage("currents");
  const { wf, version, helpers, refresh, me, error } = useWF();
  const params = useSearchParams();
  const router = useRouter();
  const qParam = params.get("q");
  const q = useMemo(() => (wf ? helpers.query(qParam) ?? helpers.query(null) : null), [wf, helpers, qParam]);

  const miniRef = useRef<SVGSVGElement>(null);
  const flowRef = useRef<SVGSVGElement>(null);
  const tickRef = useRef<HTMLSpanElement>(null);
  const [summary, setSummary] = useState<"idle" | "busy" | "playing">("idle");
  useEffect(() => () => stopVoice(), [q?.id]); // switching request (or leaving) stops a summary mid-sentence
  const listRef = useRef<HTMLDivElement>(null);
  const [touched, setTouched] = useState<string[]>([]);
  const [replay, setReplay] = useState(0);
  const [optimistic, setOptimistic] = useState<Record<string, Row[]>>({});
  // server row count per query when its optimistic rows were added
  const optBase = useRef<Record<string, number>>({});
  const [typing, setTyping] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // live elapsed while a request is open
  useEffect(() => {
    if (q?.status !== "active") return;
    const t = setInterval(() => setNow(Date.now()), 30e3);
    return () => clearInterval(t);
  }, [q?.status, q?.id]);

  useEffect(() => { if (q) document.title = `AVATAR Currents · ${q.title}`; }, [q?.title]);
  useEffect(() => { setSendErr(null); setTyping(false); }, [q?.id]);

  // mini-map: redraw on every snapshot
  useEffect(() => {
    if (!wf || !q || !miniRef.current) return;
    setTouched(renderMini(miniRef.current, wf, q, helpers));
  }, [wf, version, q, helpers]);

  // path: replay when the query or its hops change, or on ↻ Replay
  const hopKey = q ? `${q.id}|${q.status}|${q.hops.map((h) => `${h.who}:${h.verdict}`).join(",")}|${q.learned?.note ?? ""}` : "";
  const latest = useRef({ wf, q, helpers });
  latest.current = { wf, q, helpers };
  useEffect(() => {
    const { wf: w, q: qq, helpers: h } = latest.current;
    if (!w || !qq || !flowRef.current) return;
    const tick = (t: string) => {
      const m = tickRef.current; if (!m) return;
      m.textContent = t; m.classList.remove("in"); void m.offsetWidth; m.classList.add("in");
    };
    return playFlow({ svg: flowRef.current, tick, wf: w, q: qq, h, firstText: w.transactions[qq.id]?.[0]?.text || qq.title });
  }, [hopKey, replay]);

  // Once the snapshot carries new rows for a query, keep only server rows (no duplicates).
  useEffect(() => {
    if (!wf) return;
    const done = Object.keys(optBase.current).filter((id) => (wf.transactions[id]?.length ?? 0) > optBase.current[id]);
    if (!done.length) return;
    done.forEach((id) => delete optBase.current[id]);
    setOptimistic((o) => Object.fromEntries(Object.entries(o).filter(([id]) => !done.includes(id))));
  }, [wf, version]);

  const rows: Row[] = useMemo(() => {
    if (!wf || !q) return [];
    return [...(wf.transactions[q.id] ?? []).map((x) => ({ ...x })), ...(optimistic[q.id] ?? [])];
  }, [wf, q, optimistic]);

  useEffect(() => { const l = listRef.current; if (l) l.scrollTop = l.scrollHeight; }, [rows.length, typing, q?.id]);

  const select = useCallback((id: string) => {
    if (id === q?.id) return;
    router.replace(`/currents?q=${encodeURIComponent(id)}`, { scroll: false });
  }, [q?.id, router]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg || !wf || !q) return;
    setText(""); setSendErr(null);
    const qid = q.id, tz = wf.company.timezone;
    optBase.current[qid] ??= wf.transactions[qid]?.length ?? 0;
    const push = (r: Row) => setOptimistic((o) => ({ ...o, [qid]: [...(o[qid] ?? []), r] }));
    push({ id: `opt-${Date.now()}`, t: clock(new Date().toISOString(), tz), from: me, kind: "you", text: msg, fresh: true });
    setTyping(true);
    try {
      const r = await fetch("/api/agent/say", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ as: me, text: msg, request_id: qid }),
        signal: AbortSignal.timeout(20e3), // the agent may think for a while; never spin forever
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const res = (await r.json()) as SayResponse;
      if (!res.ok) throw new Error("not ok");
      setTyping(false);
      if (res.reply) {
        push({ id: `opt-r-${Date.now()}`, t: clock(new Date().toISOString(), tz), from: "wf", kind: "msg", text: res.reply, fresh: true });
        toast("msg", "New message", "AVATAR replied", res.reply.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;")));
        setTimeout(hideToast, 4200);
      }
      await refresh(); // the effect below swaps optimistic rows for the agent's real events
    } catch {
      setTyping(false);
      setSendErr("AVATAR isn't reachable right now, so this message wasn't delivered.");
      toast("msg", "Agent not reachable", "Your message wasn't delivered", "Try again once the agent is running.");
    }
  };

  /* ---------- Summary: AVATAR reads out where this request stands (ElevenLabs) ---------- */
  const summarize = async () => {
    if (!q) return;
    if (summary !== "idle") { stopVoice(); setSummary("idle"); return; } // second press stops it
    unlockVoice(); // inside the click, so the clip can play once it's ready
    setSummary("busy");
    const who = (id: string) => (id === "wf" || id === "agent" ? "AVATAR" : helpers.nameOf(id));
    const body: SummaryRequest = {
      request_id: q.id, title: q.title, status: q.rawStatus, requester: who(q.requester),
      steps: rows.slice(-30).map((m) => ({ who: who(m.from), kind: m.kind, text: m.text.slice(0, 300), at: m.t })),
    };
    let text: string;
    try {
      const r = await fetch("/api/agent/summary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30e3) });
      const res = (await r.json()) as SummaryResponse;
      if (!r.ok || !res.ok || !res.text) throw new Error("no summary");
      text = res.text;
    } catch {
      // Agent down or out of AI credits: a plain summary from the hops still works.
      const path = [...new Set(q.hops.map((h) => who(h.who)))];
      const where = q.rawStatus === "resolved" ? "It's resolved" : q.rawStatus === "denied" ? "It was denied" : q.rawStatus === "stuck" ? "It's stuck" : `It's with ${path.at(-1) ?? "AVATAR"} now`;
      text = `${q.title}, asked by ${who(q.requester)}. It went through ${q.hops.length} ${q.hops.length === 1 ? "hop" : "hops"}${path.length ? `: ${path.join(", ")}` : ""}. ${where}.`;
    }
    const esc = (x: string) => x.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"));
    toast("msg", "Summary", esc(q.title), esc(text));
    setSummary("playing");
    try { await speakLine(text); }
    catch (err) { toast("msg", "Voice unavailable", "Here's the summary as text", esc(String(err instanceof Error ? err.message : err))); }
    finally { setSummary("idle"); }
  };

  /* ---------- states without a query ---------- */
  if (!wf || !q) {
    const msg = error ? `Couldn't load data: ${error}` : !wf ? "Loading…" : "No requests yet. Text AVATAR to start one.";
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
        <Sea />
        <main className="wrap">
          <section className="head milk still title-card" aria-labelledby="pt"
            data-tour="1|Currents|Once you text AVATAR a request, this page follows it end to end: who it went to, who passed it on, and who finally owned it. There's nothing in flight yet.">
            <div className="bar"><span className="logo-orb"></span>One query, end to end<span className="live"><i></i>live</span></div>
            <div className="body">
              <div className="top"><h1 className="page-title" id="pt">Currents</h1></div>
              <div className="qt">{msg}</div>
              <div className="more"><div><span className="page-sub">Where a single request travelled, and who it touched.</span></div></div>
            </div>
          </section>
        </main>
      </>
    );
  }

  const [chipCls, chipTxt] = statusChip(q);
  const elapsed = q.status === "active" ? duration(now - new Date(q.startedIso).getTime()) : q.elapsed;
  const n = q.hops.length;
  const live = wf.allQueries.filter((x) => !wf.queries.some((y) => y.id === x.id));
  const active = wf.queries.filter((x) => x.status === "active").length;
  const ownerId = q.hops.at(-1)?.who;
  const owner = ownerId ? helpers.nameOf(ownerId) : "AVATAR";
  const dot = (x: WfQuery) => (x.rawStatus === "denied" || x.rawStatus === "stuck" ? "#F0715A" : x.status === "done" ? "#2E9E3A" : "#F2A114");
  const nameOf = (id: string) => (id === me ? "You" : helpers.nameOf(id));
  const orbOf = (id: string) => (id === "wf" || id === "agent" ? "" : id === me ? "accent" : ORBS[hash(id) % 4]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <Sea />
      <main className="wrap">
        <section className="head milk still title-card" aria-labelledby="pt" data-tour="1|Currents|One request, end to end: who it went to, who passed it on, and who finally owned it.">
          <div className="bar"><span className="logo-orb"></span>One query, end to end<span className="live"><i></i>live</span></div>
          <div className="body">
            <div className="top"><h1 className="page-title" id="pt">Currents</h1></div>
            <div className="qt" id="qTitle">{q.title}</div>
            <div className="more"><div>
              <span className="page-sub">Where a single request travelled, and who it touched.</span>
              <div className="meta" id="qMeta">
                <span className={chipCls}>{chipTxt}</span>
                <span><b>{elapsed}</b> {q.status === "active" ? "so far" : "total"}{q.usual ? ` · usually ${q.usual}` : ""}</span><span>· {q.type}</span><span>· started {q.started}</span>
              </div>
            </div></div>
            <div className="seg switcher" id="switcher" role="group" aria-label="Choose a query" data-tour="2|Your queries|Switch between the requests you have open. Each one has its own path and chat."
              onClick={(e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-q]"); if (b) select(b.dataset.q!); }}>
              {wf.queries.map((x) => (
                <button key={x.id} data-q={x.id} aria-pressed={x.id === q.id} title={x.title}><i className="dot" style={{ background: dot(x) }}></i>{x.type}</button>
              ))}
              {live.map((x) => (
                <button key={x.id} data-q={x.id} aria-pressed={x.id === q.id} title={`Live: ${x.title}`}><i className="dot" style={{ background: dot(x) }}></i>{x.type} · live</button>
              ))}
            </div>
          </div>
        </section>

        <section className="ref milk" aria-label="Position in the org" data-tour="3|Where it sits|The same request on the full org map in Roots.">
          <div className="bar">Where it sits in Roots</div>
          <div className="body">
            <svg id="mini" ref={miniRef} viewBox="-120 -80 240 160" role="img" aria-label="Mini map of the org with this query highlighted"></svg>
            <div className="foot"><span id="miniNote">{touched.length} of {wf.org.length} departments touched</span>
              <Link className="pill ghost" href={touched[0] ? `/roots?focus=${touched[0]}` : "/roots"}>Open in Roots</Link></div>
          </div>
        </section>

        <section className="flow milk still" aria-label="Path of the query" data-tour="4|The path|Each numbered stop is a hop. The dashed arc at the end is the shortcut AVATAR learned for next time.">
          <div className="bar">Path<span className="chip info" id="hopChip" style={{ textShadow: "none" }}>{n} {n === 1 ? "hop" : "hops"}</span><button className="pill ghost" id="replay" onClick={() => setReplay((r) => r + 1)}>↻ Replay</button></div>
          <div className="stage"><svg id="flow" ref={flowRef} viewBox="0 0 1000 380" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Left to right flow of hops"></svg></div>
          <div className="legend" aria-hidden="true"><span><i style={{ background: "var(--accent)" }}></i>You</span><span><i style={{ background: "#F0715A" }}></i>Redirected</span><span><i style={{ background: "#F2A114" }}></i>Delegated</span><span><i style={{ background: "#1FA889" }}></i>Passed on</span><span><i style={{ background: "#2E9E3A" }}></i>Approved / answered</span><span><i style={{ background: "#2A8CE8" }}></i>Waiting</span></div>
          <div className="ticker" aria-live="polite"><svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg><span className="msg" id="tick" ref={tickRef}></span><span className="chip">just now</span></div>
        </section>

        <aside className="tx milk still" aria-label="Transactions" data-tour="5|Transactions|Every message, approval and payment on this request. Type below to message AVATAR about it.">
          <div className="bar">Transactions<span className="live"><i></i><span id="activeCount">{active} active {active === 1 ? "chat" : "chats"}</span></span>
            <button className="pill ghost summary" onClick={summarize} aria-label="Hear a summary of this request" title="AVATAR reads out where this request stands">
              {summary === "busy" ? "Summarising…" : summary === "playing" ? "■ Stop" : "🔊 Summary"}</button></div>
          <div className="chats" id="chatsRow"><span className={`orb sm ${q.status === "done" ? "" : "amber"}`}></span><span>{q.status === "done" ? "Closed" : "Open"} thread with <b style={{ color: "var(--ink)" }}>{owner}</b> · {rows.length} messages</span></div>
          <div className="list" id="txList" ref={listRef} aria-live="polite">
            {rows.map((m) => {
              const k = KIND[m.kind], sys = (m.from === "wf" || m.from === "agent") && m.kind !== "msg", name = nameOf(m.from);
              return (
                <div key={m.id} className={`msgi${m.from === me ? " me" : ""}${sys ? " sys" : ""}${m.fresh ? " new" : ""}`}>
                  <span className={`orb ${orbOf(m.from)}`}>{m.from === "wf" || m.from === "agent" ? "W" : name.charAt(0)}</span>
                  <div><div className="hd"><b>{name}</b><time>{m.t}</time>{k && <span className={`chip ${k[0]}`}>{k[1]}</span>}</div><div className="tx-t">{m.text}</div></div>
                </div>
              );
            })}
            {typing && <div className="msgi sys new"><span className="orb">W</span><div><div className="tx-t typing"><i></i><i></i><i></i></div></div></div>}
            {sendErr && <div className="msgi sys new" role="alert"><span className="orb grey">!</span><div><div className="tx-t">{sendErr}</div></div></div>}
          </div>
          <form className="compose" id="compose" autoComplete="off" onSubmit={send}>
            <input id="msgIn" type="text" placeholder="Message AVATAR about this query…" aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="pill" type="submit">Send</button>
          </form>
        </aside>
      </main>
    </>
  );
}

function Sea() {
  return (
    <div className="sea" aria-hidden="true"><svg viewBox="0 0 1200 28" preserveAspectRatio="none"><path d="M0 14 Q75 2 150 14 T300 14 T450 14 T600 14 T750 14 T900 14 T1050 14 T1200 14" fill="none" stroke="#fff" strokeWidth="2" /></svg></div>
  );
}
