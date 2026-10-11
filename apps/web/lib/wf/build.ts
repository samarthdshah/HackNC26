// RawData → WF. Pure: the same code runs on Tiger rows and on the fixtures, so the two
// sources can't disagree. Stats follow data/tiger/schema.sql's insights_* views exactly
// (wf-check.ts asserts the seeded values).

import type {
  Event, Hop, Request, WF, WfDept, WfDeptStat, WfHop, WfPerson, WfQuery, WfRoute, WfStats, WfTx, WfWeek,
} from "@wayfinder/shared";
import { clock, dayClock, duration, firstName, taskLabel } from "./format";
import { verdictOf, txOf } from "./map";
import { matchTopics } from "./match";
import type { RawData } from "./source";

const H = 3600e3;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ms = (iso: string) => new Date(iso).getTime();
const group = <T, K>(xs: T[], key: (x: T) => K) => {
  const m = new Map<K, T[]>();
  for (const x of xs) { const k = key(x); m.get(k)?.push(x) ?? m.set(k, [x]); }
  return m;
};

// Short department labels for small charts (v6 used its own SHORT table).
const SHORT: Record<string, string> = {
  dept_people: "People", dept_it: "IT", dept_workplace: "Workplace", dept_finance: "Finance", dept_platform: "Platform",
  dept_data_platform: "Data Plat", dept_analytics_eng: "Analytics", dept_commerce: "Commerce", dept_hr: "HR", dept_legal: "Legal",
};

export interface BuildOptions { me?: string; now?: number }

export function buildWF(raw: RawData, opts: BuildOptions = {}): WF {
  const now = opts.now ?? Date.now();
  const tz = raw.company.timezone;
  const meId = opts.me ?? "p_leo";

  // ---------- names ----------
  const names: Record<string, string> = { agent: "AVATAR", wf: "AVATAR", ...raw.extraNames };
  for (const a of raw.actors) names[a.id] = a.name;
  for (const p of raw.people) names[p.id] = p.name;
  for (const d of raw.departments) names[d.id] = d.name;
  const name = (id: string) => names[id] ?? id;
  const deptOf = new Map<string, string>();
  for (const a of raw.actors) if (a.department_id) deptOf.set(a.id, a.department_id);
  for (const p of raw.people) deptOf.set(p.id, p.department_id);

  // ---------- org: departments → teams → people ----------
  // The directory has no teams, so each department splits into one team per in-department manager.
  const byId = new Map(raw.people.map((p) => [p.id, p]));
  const leadOf = (id: string): string => {
    const p = byId.get(id)!;
    const reports = raw.people.some((q) => q.manager_id === id && q.department_id === p.department_id);
    if (reports) return id;
    const m = p.manager_id ? byId.get(p.manager_id) : undefined;
    return m && m.department_id === p.department_id ? m.id : id;
  };
  const org: WfDept[] = raw.departments.map((d) => {
    const members = raw.people.filter((p) => p.department_id === d.id);
    const teams = group(members, (p) => leadOf(p.id));
    return {
      id: d.id, name: d.name, short: SHORT[d.id] ?? d.name, head_id: d.head_id,
      subs: [...teams].map(([lead, ps]) => ({
        id: `team_${lead.replace(/^p_/, "")}`,
        name: `${firstName(name(lead))}'s team`, // the directory has no team names; a lead-named team never repeats its department
        people: ps.map((p) => p.name),
        ids: ps.map((p) => p.id),
      })),
    };
  });
  const teamOf = new Map<string, { id: string; name: string }>();
  for (const d of org) for (const s of d.subs) for (const id of s.ids) teamOf.set(id, { id: s.id, name: s.name });
  const people: WfPerson[] = raw.people.map((p) => ({
    id: p.id, name: p.name, first: firstName(p.name), dept: p.department_id, deptName: name(p.department_id),
    sub: teamOf.get(p.id)?.id ?? p.department_id, subName: teamOf.get(p.id)?.name ?? name(p.department_id),
    role: p.role, status: p.status, out_until: p.out_until, delegate_id: p.delegate_id, manager_id: p.manager_id, skills: p.skills,
  }));
  const me = people.find((p) => p.id === meId) ?? people.find((p) => p.id === "p_leo") ?? people[0];

  // ---------- per-request indexes ----------
  const hopsBy = group([...raw.hops].sort((a, b) => a.seq - b.seq), (h) => h.request_id);
  const eventsBy = group(raw.events.filter((e) => e.request_id), (e) => e.request_id!);
  const hopsOf = (id: string) => hopsBy.get(id) ?? [];
  const eventsOf = (id: string) => eventsBy.get(id) ?? [];
  const reqById = new Map(raw.requests.map((r) => [r.id, r]));

  // Hours each hop's receiver held the request (hop_steps.hours): until the next hop, or until resolved.
  const holdHours = (r: Request, hs: Hop[]) =>
    hs.map((h, i) => {
      const end = hs[i + 1]?.at ?? r.resolved_at;
      return end ? (ms(end) - ms(h.at)) / H : null;
    });

  // ---------- queries ----------
  const seedResolved = raw.requests.filter((r) => r.origin === "seed" && r.status === "resolved");
  const usualByType = new Map<string, number>();
  for (const [t, rs] of group(seedResolved, (r) => r.task_type)) usualByType.set(t, median(rs.map((r) => ms(r.resolved_at!) - ms(r.created_at)))!);

  function pendingStop(r: Request, hs: Hop[]): WfHop | null {
    if (r.status === "resolved" || r.status === "denied") return null;
    // Whoever the agent is waiting on now: the latest ask in the event log, else the last redirect.
    const asks = eventsOf(r.id).filter((e) => ["routed", "approval_requested", "escalated", "delegated"].includes(e.type));
    const last = asks[asks.length - 1];
    const p = (last?.payload ?? {}) as Record<string, any>;
    const who: string | undefined =
      last?.type === "routed" ? p.owner ?? p.chain?.[p.chain.length - 1]
      : last?.type === "approval_requested" ? p.approver
      : last ? p.to
      : hs[hs.length - 1]?.redirect_to ?? undefined;
    if (!who) return null;
    const lastHop = hs[hs.length - 1];
    if (lastHop && lastHop.to === who && lastHop.outcome === "pending") return null;
    const atIso = last?.ts ?? lastHop?.at ?? r.created_at;
    return {
      seq: (lastHop?.seq ?? 0) + 1, who, verdict: "pending", outcome: "pending",
      msg: last?.type === "approval_requested" ? "Waiting on approval by text." : `Waiting on ${who.startsWith("p_") ? firstName(name(who)) : name(who)}.`,
      at: clock(atIso, tz), atIso, synthetic: true,
    };
  }

  function toQuery(r: Request): WfQuery {
    const hs = hopsOf(r.id);
    const evs = eventsOf(r.id);
    const approved = evs.some((e) => e.type === "approved");
    const hops: WfHop[] = hs.map((h) => ({
      seq: h.seq, who: h.to, verdict: verdictOf(h.outcome, approved), outcome: h.outcome, msg: h.note ?? "",
      at: clock(h.at, tz), atIso: h.at, redirect_to: h.redirect_to ?? null,
    }));
    const stop = pendingStop(r, hs);
    if (stop) hops.push(stop);
    const change = raw.edgeChanges.find((c) => c.request_id === r.id && (c.reason === "redirected" || c.reason === "delegated") && c.source === "learned");
    const done = r.status === "resolved" || r.status === "denied";
    const usualMs = usualByType.get(r.task_type) ?? null;
    return {
      id: r.id, title: r.title, task_type: r.task_type, type: taskLabel(r.task_type),
      status: done ? "done" : "active", rawStatus: r.status, requester: r.requester_id,
      started: dayClock(r.created_at, now, tz), startedIso: r.created_at, resolvedIso: r.resolved_at,
      elapsed: duration((r.resolved_at ? ms(r.resolved_at) : now) - ms(r.created_at)),
      usual: usualMs === null ? null : duration(usualMs), usualMs,
      hops, hr: r.hr_sensitive, origin: r.origin,
      ...(change && {
        learned: {
          from: change.from, to: change.to, task_type: change.task_type,
          note: change.reason === "delegated"
            ? `${firstName(name(change.from))} is out: ${firstName(name(change.to))} covers ${taskLabel(change.task_type).toLowerCase()}`
            : `${taskLabel(change.task_type)} goes straight to ${name(change.to)}`,
        },
      }),
    };
  }

  const involves = (r: Request, id: string) => {
    if (r.requester_id === id || hopsOf(r.id).some((h) => h.to === id || h.from === id)) return true;
    return eventsOf(r.id).some((e) => {
      const p = e.payload as Record<string, unknown>;
      return [p.approver, p.to, p.owner, p.by, p.from, p.a, p.b].includes(id)
        || [p.invitees, p.yes, p.chain].some((xs) => Array.isArray(xs) && xs.includes(id));
    });
  };
  const newestFirst = (a: Request, b: Request) => ms(b.created_at) - ms(a.created_at);
  const mine = raw.requests.filter((r) => involves(r, me.id)).sort(newestFirst);
  const live = raw.requests.filter((r) => r.origin === "agent" && !mine.includes(r)).sort(newestFirst);
  const queries = mine.map(toQuery);
  const allQueries = [...queries, ...live.map(toQuery)];

  // ---------- transactions ----------
  const transactions: Record<string, WfTx[]> = {};
  for (const q of allQueries) {
    const r = reqById.get(q.id)!;
    const evs = eventsOf(q.id);
    const rows: WfTx[] = [];
    if (evs.some((e) => e.type === "request_created")) {
      // A reply shows once: the hop event repeats the reply_in text as its note.
      const said = new Set(evs.filter((e) => e.type === "reply_in").map((e) => `${e.actor}|${(e.payload as { text?: string }).text}`));
      for (const e of evs) {
        const p = e.payload as { to?: string; note?: string; outcome?: string };
        if (e.type === "hop" && p.outcome !== "handled" && said.has(`${p.to}|${p.note}`)) continue;
        if (e.type === "reply_in" && evs.some((h) => h.type === "hop" && (h.payload as typeof p).outcome === "handled" && `${(h.payload as typeof p).to}|${(h.payload as typeof p).note}` === `${e.actor}|${(e.payload as { text?: string }).text}`)) continue;
        const t = txOf(e, name, me.id);
        if (t && t.text) rows.push({ id: e.id, t: clock(e.ts, tz), ts: e.ts, type: e.type, ...t });
      }
    } else {
      // Seeded history has no event log here: tell it from the request and its hops.
      rows.push({ id: `${r.id}:0`, t: clock(r.created_at, tz), ts: r.created_at, type: "request_created", from: r.requester_id, kind: "msg", text: r.title });
      for (const h of hopsOf(r.id)) {
        rows.push({ id: `${r.id}:r${h.seq}`, t: clock(h.at, tz), ts: h.at, type: "routed", from: "wf", kind: "route", text: `Routed to ${name(h.to)}.` });
        if (h.outcome !== "pending" && h.note) {
          const at = hopsOf(r.id).find((x) => x.seq === h.seq + 1)?.at ?? r.resolved_at ?? h.at;
          rows.push({ id: `${r.id}:h${h.seq}`, t: clock(at, tz), ts: at, type: "hop", from: h.to, kind: h.outcome === "handled" ? "approve" : "msg", text: h.note });
        }
      }
    }
    transactions[q.id] = rows.sort((a, b) => ms(a.ts) - ms(b.ts));
  }

  // ---------- stats (insights_* views) ----------
  const resolved = raw.requests.filter((r) => r.status === "resolved");
  const steps = resolved.flatMap((r) => {
    const hs = hopsOf(r.id), hours = holdHours(r, hs);
    return hs.map((h, i) => ({ r, h, hours: hours[i] ?? 0, dept: deptOf.get(h.to) ?? h.to }));
  });
  const bounceHours = sum(steps.filter((s) => s.h.outcome === "bounced").map((s) => s.hours));

  const resolveH = (r: Request) => (ms(r.resolved_at!) - ms(r.created_at)) / H;
  const checkout = resolved
    .filter((r) => r.task_type === "checkout_incident" && hopsOf(r.id).length)
    .map((r) => ({ r, direct: deptOf.get(hopsOf(r.id)[0].to) === "dept_platform", hours: resolveH(r) }));
  const routedC = checkout.filter((c) => !c.direct), directC = checkout.filter((c) => c.direct);
  const checkoutSaved = routedC.length && directC.length ? routedC.length * (avg(routedC.map((c) => c.hours)) - avg(directC.map((c) => c.hours))) : 0;

  const baseline = new Map<string, number>();
  for (const [t, rs] of group(seedResolved, (r) => r.task_type)) baseline.set(t, avg(rs.map(resolveH)));
  const agentResolved = resolved.filter((r) => r.origin === "agent" && baseline.has(r.task_type));
  const agentSavedOf = (r: Request) => baseline.get(r.task_type)! - resolveH(r);
  const agentSaved = sum(agentResolved.map(agentSavedOf));

  const onboarding = resolved.filter((r) => r.task_type === "onboarding").sort(newestFirst).slice(0, 10);
  const checkoutRows = (["direct", "routed"] as const)
    .map((path) => ({ path, rows: path === "direct" ? directC : routedC }))
    .filter((x) => x.rows.length)
    .map(({ path, rows }) => ({
      path, incidents: rows.length, avg_minutes: Math.round(avg(rows.map((c) => c.hours * 60))),
      avg_hops: round(avg(rows.map((c) => hopsOf(c.r.id).length))),
    }));

  const hopCount = (r: Request) => hopsOf(r.id).length;
  const agentDone = raw.requests.filter((r) => r.origin === "agent" && r.status === "resolved");
  const teamsCount = org.reduce((n, d) => n + d.subs.length, 0);
  const medBefore = median(seedResolved.map((r) => ms(r.resolved_at!) - ms(r.created_at))) ?? 0;
  const medAfter = median(agentDone.map((r) => ms(r.resolved_at!) - ms(r.created_at)));

  const stats: WfStats = {
    hoursSaved: round(checkoutSaved + agentSaved),
    hoursLost: round(bounceHours),
    agentSaved: round(agentSaved),
    agentResolved: agentResolved.length,
    peopleHelped: new Set(raw.requests.map((r) => r.requester_id)).size,
    departments: raw.departments.length,
    subDepartments: teamsCount,
    requestsRouted: raw.requests.length,
    avgHopsBefore: round(avg(seedResolved.map(hopCount))),
    avgHopsAfter: agentDone.length ? round(avg(agentDone.map(hopCount))) : null,
    introsMade: raw.events.filter((e) => e.type === "intro_sent").length,
    approvalsByText: raw.events.filter((e) => e.type === "approved").length,
    medianResolve: medAfter === null ? null : duration(medAfter),
    medianBefore: duration(medBefore),
    medianResolveMs: medAfter,
    medianBeforeMs: medBefore,
    newHires: {
      requests: onboarding.length,
      avg_days: round(avg(onboarding.map((r) => resolveH(r) / 24)), 2),
      avg_hops: round(avg(onboarding.map(hopCount)), 2),
    },
    checkout: checkoutRows,
  };

  // ---------- series: last 12 weeks (Monday starts, company time) ----------
  const end = Math.max(now, ms(raw.company.demo_date + "T23:59:59Z"));
  const monday = (t: number) => { const d = new Date(t); const k = (d.getUTCDay() + 6) % 7; d.setUTCHours(0, 0, 0, 0); return d.getTime() - k * 86400e3; };
  const firstWeek = monday(end) - 11 * 7 * 86400e3;
  const weekIdx = (iso: string) => Math.floor((ms(iso) - firstWeek) / (7 * 86400e3));
  const series: WfWeek[] = Array.from({ length: 12 }, (_, i) => ({
    week: `W${i + 1}`, weekStart: new Date(firstWeek + i * 7 * 86400e3).toISOString().slice(0, 10),
    requests: 0, resolved: 0, hops: 0, hoursLost: 0, hoursSaved: 0,
  }));
  const hopsPerWeek: number[][] = series.map(() => []);
  for (const r of raw.requests) {
    const w = weekIdx(r.created_at);
    if (w >= 0 && w < 12) { series[w].requests++; hopsPerWeek[w].push(hopCount(r)); }
    if (r.status === "resolved" && r.resolved_at) {
      const v = weekIdx(r.resolved_at);
      if (v >= 0 && v < 12) {
        series[v].resolved++;
        if (r.origin === "agent" && baseline.has(r.task_type)) series[v].hoursSaved += agentSavedOf(r);
      }
    }
  }
  for (const s of steps) if (s.h.outcome === "bounced") { const w = weekIdx(s.h.at); if (w >= 0 && w < 12) series[w].hoursLost += s.hours; }
  series.forEach((s, i) => { s.hops = round(avg(hopsPerWeek[i])); s.hoursLost = round(s.hoursLost); s.hoursSaved = round(s.hoursSaved); });

  // ---------- byDept (insights_bottlenecks + who raised what) ----------
  const stepsByDept = group(steps, (s) => s.dept);
  const reqByDept = group(raw.requests, (r) => deptOf.get(r.requester_id) ?? "");
  const byDept: WfDeptStat[] = raw.departments.map((d) => {
    const ss = stepsByDept.get(d.id) ?? [];
    const bounced = ss.filter((s) => s.h.outcome === "bounced");
    const raised = reqByDept.get(d.id) ?? [];
    const seedDone = raised.filter((r) => r.origin === "seed" && r.status === "resolved");
    const agentDoneD = raised.filter((r) => r.origin === "agent" && r.status === "resolved");
    return {
      id: d.id, name: d.name,
      hoursSaved: round(sum(agentDoneD.filter((r) => baseline.has(r.task_type)).map(agentSavedOf))),
      hoursLost: round(sum(bounced.map((s) => s.hours))),
      totalHours: round(sum(ss.map((s) => s.hours))),
      requests: raised.length,
      hopsBefore: round(avg(seedDone.map(hopCount))),
      hopsAfter: agentDoneD.length ? round(avg(agentDoneD.map(hopCount))) : null,
      bounces: bounced.length,
      bouncePct: ss.length ? round((100 * bounced.length) / ss.length) : 0,
    };
  }).sort((a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name));

  // ---------- routing: department → department handoffs ----------
  const flows = new Map<string, number>();
  for (const h of raw.hops) {
    const a = deptOf.get(h.from), b = deptOf.get(h.to);
    if (!a || !b || a === b) continue;
    flows.set(`${a}|${b}`, (flows.get(`${a}|${b}`) ?? 0) + 1);
  }
  const routing: WfRoute[] = [...flows].map(([k, n]) => { const [a, b] = k.split("|"); return [a, b, n] as WfRoute; }).sort((x, y) => y[2] - x[2]);

  // ---------- Lagoon ----------
  const { topics, matches } = matchTopics({ me, people, requests: raw.requests, hops: raw.hops, bookings: raw.bookings, name, time: (iso) => clock(iso, tz) });

  return {
    source: raw.source,
    generatedAt: new Date(now).toISOString(),
    company: { name: raw.company.name, timezone: tz, demo_date: raw.company.demo_date },
    me, org, people, actorNames: names,
    queries, allQueries, transactions, matches, topics, stats, series, byDept, routing,
    edges: raw.edges,
    darwin: [], rules: [], darwinSource: "none",
  };
}

/** Rebuild one query's view (for targeted refetch after a live event). */
export function pickQuery(wf: WF, id: string) {
  return { query: wf.allQueries.find((q) => q.id === id) ?? null, transactions: wf.transactions[id] ?? [] };
}

export type { Event };
