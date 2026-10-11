"use client";
// Client store: one WF snapshot for every page, refreshed on demand (live.ts calls refresh
// after agent events). Pages read it with useWF(); helpers mirror v6 data.js.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { WF, WfDept, WfPerson, WfQuery } from "@wayfinder/shared";

export interface WFHelpers {
  person: (id: string) => WfPerson | undefined;
  dept: (id: string) => WfDept | undefined;
  /** v6 fell back to the first query; null here so pages can show an empty state. */
  query: (id?: string | null) => WfQuery | null;
  /** "AVATAR" for wf/agent, a first name for people, the department name for teams. */
  nameOf: (id: string) => string;
}

interface Ctx {
  wf: WF | null;
  error: string | null;
  version: number; // bumps on every new snapshot; scenes key their rebuilds on it
  me: string;
  refresh: () => Promise<void>;
  helpers: WFHelpers;
}

const WFContext = createContext<Ctx | null>(null);

export function makeHelpers(wf: WF | null): WFHelpers {
  const people = new Map(wf?.people.map((p) => [p.id, p]));
  const depts = new Map(wf?.org.map((d) => [d.id, d]));
  const queries = new Map(wf?.allQueries.map((q) => [q.id, q]));
  return {
    person: (id) => people.get(id),
    dept: (id) => depts.get(id),
    query: (id) => (id ? queries.get(id) ?? null : wf?.queries[0] ?? null),
    nameOf: (id) => (id === "wf" || id === "agent" ? "AVATAR" : people.get(id)?.first ?? wf?.actorNames[id] ?? id),
  };
}

export function WFProvider({ children }: { children: React.ReactNode }) {
  const [wf, setWf] = useState<WF | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [me, setMe] = useState("p_leo");
  const inflight = useRef<Promise<void> | null>(null);
  const meRef = useRef(me);

  const refresh = useCallback(() => {
    // Collapse bursts: one fetch at a time, the latest result wins.
    inflight.current ??= fetch(`/api/wf?me=${encodeURIComponent(meRef.current)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((next: WF) => { setWf(next); setError(null); setVersion((v) => v + 1); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { inflight.current = null; });
    return inflight.current;
  }, []);

  useEffect(() => {
    // Dev override: ?me=p_nina views the app as someone else (handy with one phone).
    const q = new URLSearchParams(location.search).get("me");
    if (q) { meRef.current = q; setMe(q); }
    void refresh();
  }, [refresh]);

  const helpers = useMemo(() => makeHelpers(wf), [wf]);
  const value = useMemo(() => ({ wf, error, version, me, refresh, helpers }), [wf, error, version, me, refresh, helpers]);
  return <WFContext.Provider value={value}>{children}</WFContext.Provider>;
}

export function useWF() {
  const c = useContext(WFContext);
  if (!c) throw new Error("useWF outside WFProvider");
  return c;
}
