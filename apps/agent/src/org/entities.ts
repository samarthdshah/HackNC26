// Names <-> ids for people and teams, so "ask Tom" or "try Analytics Eng" resolve.

import { departments, getDepartment, getPerson, people, type Person } from "../data/fixtures.ts";

export const isTeam = (id: string) => id.startsWith("dept_");

export function nameOf(id: string): string {
  if (id === "agent") return "Wayfinder";
  return getPerson(id)?.name ?? getDepartment(id)?.name ?? id;
}

export const firstName = (id: string) => nameOf(id).split(" ")[0];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const ALIASES: Record<string, string> = {
  "analytics eng": "dept_analytics_eng",
  "analytics engineering": "dept_analytics_eng",
  ae: "dept_analytics_eng",
  "data platform": "dept_data_platform",
  "data eng": "dept_data_platform",
  "people ops": "dept_people",
  hr: "dept_people",
  it: "dept_it",
  workplace: "dept_workplace",
  facilities: "dept_workplace",
  finance: "dept_finance",
  procurement: "dept_finance",
  commerce: "dept_commerce",
  platform: "dept_platform",
  sre: "dept_platform",
};

/** Best-effort match of free text ("Tom", "Analytics Engineering", "p_tom") to an id. */
export function resolveEntity(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const raw = text.trim();
  if (getPerson(raw) || getDepartment(raw)) return raw;
  const q = norm(raw);
  if (!q) return undefined;
  if (ALIASES[q]) return ALIASES[q];

  const dept = departments.find((d) => norm(d.name) === q || norm(d.name).includes(q) || q.includes(norm(d.name)));
  if (dept) return dept.id;

  const byFull = people.find((p) => norm(p.name) === q);
  if (byFull) return byFull.id;
  const byFirst = people.filter((p) => norm(p.name).split(" ")[0] === q.split(" ")[0]);
  if (byFirst.length === 1) return byFirst[0].id;

  for (const [alias, id] of Object.entries(ALIASES)) if (q.includes(alias)) return id;
  return undefined;
}

export function describePerson(p: Person): string {
  const dept = getDepartment(p.department_id)?.name ?? p.department_id;
  const out = p.status === "out" ? `, out until ${p.out_until?.slice(0, 10)} (delegate ${p.delegate_id ? nameOf(p.delegate_id) : "none"})` : "";
  return `${p.name} (${p.id}), ${p.role}, ${dept}${out}`;
}
