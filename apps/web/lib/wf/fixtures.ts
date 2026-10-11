// Fixtures source: data/fixtures/*.json, plus the agent's local event log when it runs
// without Tiger (apps/agent/logs/events.jsonl), folded the same way Tiger's events_derive
// trigger does. Server-only.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HR_PLACEHOLDER, HR_TASK_TYPES, type Actor, type Booking, type Event, type Hop, type OrgEdge, type OrgEdgeChange, type Request } from "@wayfinder/shared";
import type { Company, DirectoryDept, DirectoryPerson, RawData } from "./source";

const repo = resolve(process.cwd(), "../..");
const fixturesDir = process.env.WF_FIXTURES_DIR ?? join(repo, "data/fixtures");
const agentLogs = process.env.WF_AGENT_LOGS ?? join(repo, "apps/agent/logs");

const json = <T>(name: string): T => JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8"));
const jsonl = <T>(file: string): T[] =>
  existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T) : [];

const HR = new Set<string>(HR_TASK_TYPES);
const iso = (s: string | null | undefined) => (s ? new Date(s).toISOString() : null);

type FixtureRequest = Omit<Request, "hr_sensitive" | "origin"> & { hops: Omit<Hop, "request_id">[] };

/** Same masking as Tiger's events_public: HR payloads keep only structural keys. */
const STRUCTURAL = new Set(["id", "task_type", "from", "to", "redirect_to", "outcome", "seq", "status", "amount", "amount_usd", "ts", "delegate_until"]);
export function maskPayload(p: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(p).map(([k, v]) =>
    [k, (STRUCTURAL.has(k) || k.endsWith("_id") || k.endsWith("_at")) && (v === null || typeof v !== "object") ? v : HR_PLACEHOLDER]));
}

export function loadFixtures(): RawData {
  const company = json<Company>("company");
  const departments = json<DirectoryDept[]>("departments").map(({ id, name, head_id }) => ({ id, name, head_id }));
  const people = json<DirectoryPerson[]>("people").map(({ id, name, department_id, role, manager_id, status, out_until, delegate_id, skills }) =>
    ({ id, name, department_id, role, manager_id, status, out_until, delegate_id, skills: skills ?? [] }));
  const actors: Actor[] = [
    ...departments.map((d) => ({ id: d.id, kind: "department" as const, name: d.name, department_id: d.id })),
    ...people.map((p) => ({ id: p.id, kind: "person" as const, name: p.name, department_id: p.department_id })),
    { id: "agent", kind: "agent", name: "AVATAR", department_id: null },
  ];

  const requests: Request[] = [];
  const hops: Hop[] = [];
  for (const r of json<FixtureRequest[]>("requests")) {
    const hr = HR.has(r.task_type);
    const { hops: rh, ...rest } = r;
    requests.push({
      ...rest,
      title: hr ? HR_PLACEHOLDER : r.title,
      resolution: hr && r.resolution ? HR_PLACEHOLDER : r.resolution,
      created_at: iso(r.created_at)!,
      resolved_at: iso(r.resolved_at),
      hr_sensitive: hr,
      origin: "seed",
    });
    for (const h of rh) hops.push({ ...h, request_id: r.id, at: iso(h.at)!, note: hr ? HR_PLACEHOLDER : h.note ?? null });
  }

  // Live events from a Tiger-less agent run, folded like events_derive.
  const byId = new Map(requests.map((r) => [r.id, r]));
  const hrRequests = new Set(requests.filter((r) => r.hr_sensitive).map((r) => r.id));
  const raw = jsonl<Event>(join(agentLogs, "events.jsonl"));
  for (const e of raw) {
    const p = e.payload ?? {};
    if (e.type === "request_created" && HR.has(String(p.task_type))) hrRequests.add(String(e.request_id ?? p.request_id));
  }
  const hopTs = new Map<string, string>(); // request:seq → first hop event ts (when that receiver acted)
  for (const e of raw) {
    const p = e.payload ?? {};
    const rid = String(e.request_id ?? p.request_id ?? "");
    if (e.type === "request_created" && rid && !byId.has(rid)) {
      const hr = hrRequests.has(rid);
      const r: Request = {
        id: rid, task_type: String(p.task_type ?? "other"), title: hr ? HR_PLACEHOLDER : String(p.title ?? ""), requester_id: e.actor,
        created_at: e.ts, status: "open", resolved_at: null, resolved_by: null, resolution: null, hr_sensitive: hr, origin: "agent",
      };
      requests.push(r);
      byId.set(rid, r);
    } else if (e.type === "hop" && byId.has(rid)) {
      const seq = Number(p.seq);
      if (!hopTs.has(`${rid}:${seq}`)) hopTs.set(`${rid}:${seq}`, e.ts);
      if (hops.some((h) => h.request_id === rid && h.seq === seq)) continue;
      const at = seq === 1 ? byId.get(rid)!.created_at : hopTs.get(`${rid}:${seq - 1}`) ?? e.ts;
      hops.push({
        request_id: rid, seq, from: String(p.from), to: String(p.to), at, outcome: p.outcome as Hop["outcome"],
        redirect_to: (p.redirect_to as string) ?? null, note: hrRequests.has(rid) ? HR_PLACEHOLDER : (p.note as string) ?? null,
      });
    } else if ((e.type === "request_resolved" || e.type === "request_denied") && byId.has(rid)) {
      Object.assign(byId.get(rid)!, { status: e.type.slice(8), resolved_at: e.ts });
    } else if (e.type === "request_stuck" && byId.get(rid)?.status === "open") {
      byId.get(rid)!.status = "stuck";
    }
  }
  const events = raw.map((e) => {
    const rid = e.request_id ?? (e.payload?.request_id as string | undefined);
    return rid && hrRequests.has(rid) ? { ...e, payload: maskPayload(e.payload ?? {}) } : e;
  });

  // The agent's current map (logs/edges.json) overrides the chart; edges.jsonl is its change history.
  const chart = json<OrgEdge[]>("edges");
  const liveMap = join(agentLogs, "edges.json");
  const edges: OrgEdge[] = existsSync(liveMap) ? JSON.parse(readFileSync(liveMap, "utf8")) : chart;
  const edgeChanges: OrgEdgeChange[] = jsonl<OrgEdge & { ts: string; previous: number | null; reason?: string; requestId?: string }>(join(agentLogs, "edges.jsonl"))
    .map(({ ts, previous, reason, requestId, ...e }) => ({ ...e, changed_at: ts, previous_confidence: previous, reason: reason ?? null, request_id: requestId ?? null }));

  const bookings = json<Booking[]>("bookings").map((b) => ({ ...b, start: iso(b.start)!, end: iso(b.end)!, used_until: iso(b.used_until) }));

  return { source: "fixtures", company, people, departments, actors, requests, hops, events, edges, edgeChanges, bookings, extraNames: extraNames() };
}

function extraNames() {
  const out: Record<string, string> = {};
  for (const x of [...json<{ id: string; name: string }[]>("rooms"), ...json<{ id: string; name: string }[]>("vendors")]) out[x.id] = x.name;
  return out;
}

/** Directory only (people, departments, company, room and vendor names): Tiger has no roles or skills. */
export function loadDirectory() {
  const f = loadFixtures();
  return { company: f.company, people: f.people, departments: f.departments, extraNames: f.extraNames };
}
