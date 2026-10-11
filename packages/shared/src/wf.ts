// The website's view model: the v6 design's window.WF shape (docs/design/v6/shared/data.js),
// filled from Tiger or data/fixtures by apps/web/lib/wf. Field names follow data.js so the
// ported pages read the same keys; ids are the real ones (p_leo, dept_commerce).

import type { HopOutcome, OrgEdge, RequestStatus } from "./index";

/** How a hop shows on Currents. v6 had redirect|delegate|approve|answer|pending; forward is new. */
export type Verdict = "redirect" | "delegate" | "forward" | "answer" | "approve" | "pending";
/** Transaction row kinds on Currents. deny is new. */
export type TxKind = "msg" | "route" | "learn" | "approve" | "deny" | "pay" | "pending" | "you";

export interface WfPerson {
  id: string; // p_leo
  name: string;
  first: string;
  dept: string; // dept_commerce
  deptName: string;
  sub: string; // team id (one team per manager, see lib/wf/build.ts)
  subName: string;
  role: string;
  status: "active" | "out";
  out_until: string | null;
  delegate_id: string | null;
  manager_id: string | null;
  skills: string[];
}

export interface WfTeam { id: string; name: string; people: string[] /* full names, as in v6 */; ids: string[] }
export interface WfDept { id: string; name: string; short: string; head_id: string | null; subs: WfTeam[] }

export interface WfHop {
  seq: number;
  who: string; // person or department id
  verdict: Verdict;
  outcome: HopOutcome;
  msg: string;
  at: string; // display time, company timezone ("9:04")
  atIso: string;
  redirect_to?: string | null;
  synthetic?: true; // the pending stop of an open request, not yet a stored hop
}

export interface WfQuery {
  id: string;
  title: string;
  task_type: string;
  type: string; // short label for chips and the switcher ("Data access")
  status: "active" | "done";
  rawStatus: RequestStatus;
  requester: string;
  started: string; // display ("Sat 9:20")
  startedIso: string;
  resolvedIso: string | null;
  elapsed: string; // display ("1 h 12 m"); recomputed client-side while open
  usual: string | null; // median of seeded resolved requests of the same type
  usualMs: number | null;
  hops: WfHop[];
  learned?: { from: string; to: string; task_type: string; note: string };
  hr: boolean;
  origin: "seed" | "agent";
}

export interface WfTx {
  id: string;
  t: string; // display time
  ts: string; // ISO
  from: string; // actor id or "wf"
  kind: TxKind;
  text: string;
  type: string; // source event type
}

export interface WfMatch { a: string; b: string; kind: "query" | "resource" | "team"; why: string; score: number; topic: string }
export interface WfTopic { topic: string; kind: WfMatch["kind"]; why: string; ids: string[]; score: number; request_ids?: string[] }

export interface WfStats {
  hoursSaved: number; // checkout direct paging + live agent routing (insights_hours_saved, kind saved)
  hoursLost: number; // hours requests sat with a team that said "not us"
  agentSaved: number; // agent_routing alone
  agentResolved: number; // live agent requests resolved
  peopleHelped: number;
  departments: number;
  subDepartments: number;
  requestsRouted: number;
  avgHopsBefore: number; // seeded resolved requests
  avgHopsAfter: number | null; // live agent requests, null until one resolves
  introsMade: number;
  approvalsByText: number;
  medianResolve: string | null;
  medianBefore: string;
  medianResolveMs: number | null;
  medianBeforeMs: number;
  newHires: { requests: number; avg_days: number; avg_hops: number };
  checkout: { path: "direct" | "routed"; incidents: number; avg_minutes: number; avg_hops: number }[];
}

export interface WfWeek { week: string; weekStart: string; requests: number; resolved: number; hops: number; hoursLost: number; hoursSaved: number }

export interface WfDeptStat {
  id: string;
  name: string;
  hoursSaved: number; // 0 until live requests resolve faster than baseline
  hoursLost: number; // bounce hours (insights_bottlenecks.bounce_hours)
  totalHours: number;
  requests: number; // requests raised by people in this department
  hopsBefore: number;
  hopsAfter: number | null;
  bounces: number;
  bouncePct: number;
}

export type WfRoute = [from: string, to: string, n: number];

export interface WfGeneration { gen: number; avgHops: number; fitness: number; rules: number }

/** Live Darwin (agent GET /darwin): one generation's champion rule set and the admin's decision on it. */
export type DarwinDecision = "approved" | "rejected";
export interface DarwinGeneration {
  gen: number; // 1-based (Darwin's generation k is gen k+1)
  avgHops: number; // Darwin's replay of history with this generation's rules
  fitness: number; // share of Darwin's best improvement this generation reached, 0..1
  rules: number;
  ruleIds: string[];
  ruleTexts: string[];
  status: "proposed" | DarwinDecision;
  decidedAt: string | null;
}
export interface DarwinView {
  connected: boolean; // false: Darwin unreachable or DARWIN_URL unset (the page falls back to its snapshot)
  replayed: number;
  generations: DarwinGeneration[];
}
export interface WfRule {
  id: string;
  gen: number;
  text: string;
  saves: string;
  status: "approved" | "proposed" | "rejected" | "frozen";
  kind?: string;
  task_type?: string;
}

export interface WF {
  source: "tiger" | "fixtures";
  generatedAt: string;
  company: { name: string; timezone: string; demo_date: string };
  me: WfPerson;
  org: WfDept[];
  people: WfPerson[];
  actorNames: Record<string, string>; // every actor id → display name (departments, people, agent)
  queries: WfQuery[]; // the viewer's (requester, on a hop, or named in an event)
  allQueries: WfQuery[]; // the viewer's plus every live agent request
  transactions: Record<string, WfTx[]>;
  matches: WfMatch[];
  topics: WfTopic[];
  stats: WfStats;
  series: WfWeek[];
  byDept: WfDeptStat[];
  routing: WfRoute[];
  edges: OrgEdge[];
  darwin: WfGeneration[];
  rules: WfRule[];
  darwinSource: "snapshot" | "none";
}
