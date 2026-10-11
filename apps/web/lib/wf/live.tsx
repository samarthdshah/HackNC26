"use client";
// Live bridge: subscribes to the agent's GET /live (SSE) and keeps the WF snapshot fresh.
//   update  → toast the moments worth seeing, then refetch the snapshot (debounced, plus a
//             trailing refetch because the agent's Tiger writes are queued and the trigger runs after)
//   hello   → a new boot_id means the agent restarted: refetch
//   gap     → the agent couldn't replay what we missed: refetch
// EventSource reconnects by itself and sends Last-Event-ID, so short drops replay exactly.
// darwin_generation_* events also fire a window "wf:darwin" event so the Darwin page refetches its live view.

import { useEffect, useSyncExternalStore } from "react";
import type { Event, LiveHello, LiveUpdate, OrgEdge } from "@wayfinder/shared";
import { toast } from "@/lib/aero/runtime";
import { firstName, taskLabel } from "./format";
import { useWF } from "./store";

type Status = "connecting" | "live" | "offline";
let status: Status = "connecting";
const subs = new Set<() => void>();
const setStatus = (s: Status) => { status = s; subs.forEach((f) => f()); };

/** "connecting" | "live" | "offline": for a small badge on pages. */
export function useLiveStatus() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => status, () => "connecting" as Status);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function LiveBridge() {
  const { refresh, wf } = useWF();
  const names = wf?.actorNames;

  useEffect(() => {
    const url = `${process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787"}/live`;
    const es = new EventSource(url);
    let boot: string | undefined;
    let t1: ReturnType<typeof setTimeout> | undefined, t2: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t1); clearTimeout(t2);
      t1 = setTimeout(() => void refresh(), 700);
      t2 = setTimeout(() => void refresh(), 3000);
    };

    es.addEventListener("open", () => setStatus("live"));
    es.addEventListener("error", () => setStatus(es.readyState === EventSource.CLOSED ? "offline" : "connecting"));
    es.addEventListener("hello", (m) => {
      const h = JSON.parse((m as MessageEvent).data) as LiveHello;
      if (boot && boot !== h.boot_id) void refresh();
      boot = h.boot_id;
      setStatus("live");
    });
    es.addEventListener("gap", () => void refresh());
    es.addEventListener("update", (m) => {
      const u = JSON.parse((m as MessageEvent).data) as LiveUpdate;
      announce(u, (id) => names?.[id] ?? id);
      if (u.kind === "event" && (u.data as Event).type.startsWith("darwin_generation_")) window.dispatchEvent(new CustomEvent("wf:darwin"));
      soon();
    });
    return () => { es.close(); clearTimeout(t1); clearTimeout(t2); setStatus("connecting"); };
    // names only affect toast wording; reconnecting on every snapshot would lose the stream
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  return null;
}

/** Toast the events a viewer would care about; everything else just refreshes quietly. */
function announce(u: LiveUpdate, name: (id: string) => string) {
  const who = (id: unknown) => (typeof id === "string" ? (id.startsWith("p_") ? firstName(name(id)) : name(id)) : "");
  if (u.kind === "edge") {
    const e = u.data as OrgEdge;
    if (e.source === "learned" && e.confidence > 0) {
      toast("route", "AVATAR learned", esc(`${taskLabel(e.task_type)} → ${name(e.to)}`), esc(`confidence ${Math.round(e.confidence * 100)}%`));
    }
    return;
  }
  const e = u.data as Event;
  const p = e.payload as Record<string, any>;
  const title = esc(String(p.title ?? ""));
  switch (e.type) {
    case "request_created": return toast("route", "New request", esc(`${who(e.actor)}: ${p.title ?? p.goal ?? ""}`), esc(taskLabel(String(p.task_type ?? ""))));
    case "routed": return toast("route", "AVATAR is routing", esc(`→ ${who(p.owner)}`), title);
    case "redirected": return toast("route", "Not us → learned", esc(`${taskLabel(String(p.task_type ?? ""))} goes to ${name(String(p.to ?? ""))}`), title);
    case "approval_requested": return toast("msg", "Approval by text", esc(`Asked ${who(p.approver)}`), title);
    case "approved": return toast("route", "Approved", esc(`${who(p.approver)} said yes`), title);
    case "payment_sent": return toast("route", "Payment sent", esc(`$${p.amount_usd ?? ""} via ${p.rail ?? ""}`), title);
    case "request_resolved": return toast("route", "Resolved", title || "A request was resolved");
    case "intro_sent": return toast("myc", "Mycelium intro sent", esc(`${who(p.a)} ↔ ${who(p.b)}`), esc(String(p.topic ?? "")));
    case "darwin_hint": return toast("evo", "Darwin rule applied", esc(String(p.reason ?? "")), title);
    case "darwin_generation_approved":
    case "darwin_generation_rejected": {
      const n = Array.isArray(p.rule_ids) ? p.rule_ids.length : 0;
      const ok = e.type === "darwin_generation_approved";
      return toast("evo", `Generation ${esc(String(p.gen ?? ""))} ${ok ? "approved" : "rejected"}`, `${n} ${n === 1 ? "rule" : "rules"}`,
        ok ? "The agent now routes by its rules" : "It fell from the tree");
    }
  }
}
