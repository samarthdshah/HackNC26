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
  onboarding: "dept_people",
  hr: "dept_hr",
  "human resources": "dept_hr",
  benefits: "dept_hr",
  payroll: "dept_hr",
  legal: "dept_legal",
  counsel: "dept_legal",
  contracts: "dept_legal",
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

  // Whole words only: "it" must not match inside "with", nor "hr" inside "three".
  for (const [alias, id] of Object.entries(ALIASES)) if (new RegExp(`\\b${alias}\\b`).test(q)) return id;
  return undefined;
}

export function describePerson(p: Person): string {
  const dept = getDepartment(p.department_id)?.name ?? p.department_id;
  const out = p.status === "out" ? `, out until ${p.out_until?.slice(0, 10)} (delegate ${p.delegate_id ? nameOf(p.delegate_id) : "none"})` : "";
  return `${p.name} (${p.id}), ${p.role}, ${dept}${out}`;
}

/** HR matters stay out of war rooms and group threads (benefits, leave, employee relations). */
const SENSITIVE_TASKS = new Set(["benefits_question", "leave_request", "employee_relations"]);
export const isSensitive = (taskType: string | undefined) => Boolean(taskType && SENSITIVE_TASKS.has(taskType));
