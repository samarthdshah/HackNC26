// Read-only view over Lane C's JSON fixtures (data/fixtures). The brain only talks
// to this module, so swapping in Snowflake / Tiger Data later is a one-file change.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OrgEdge } from "@wayfinder/shared";

const dir = fileURLToPath(new URL("../../../../data/fixtures/", import.meta.url));
const load = <T>(file: string): T => JSON.parse(readFileSync(dir + file, "utf8")) as T;

export interface Company {
  name: string;
  domain: string;
  timezone: string;
  demo_date: string;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  department_id: string;
  role: string;
  manager_id: string | null;
  status: "active" | "out";
  out_until: string | null;
  delegate_id: string | null;
  access_role: string;
  skills: string[];
}

export interface Department {
  id: string;
  name: string;
  head_id: string;
  cost_center: string;
  charter: string;
}

export interface Budget {
  id: string;
  department_id: string;
  category: string;
  period: string;
  amount_usd: number;
  spent_usd: number;
  owner_id: string;
}

export interface Vendor {
  id: string;
  name: string;
  category: string;
  contact_name: string;
  contact_email: string;
  approved: boolean;
  preferred: boolean;
  owner_department_id: string;
  lead_time_hours: number;
  pricing: string;
  payment_methods: string[];
}

export interface Policy {
  id: string;
  title: string;
  text: string;
}

export const company = load<Company>("company.json");
export const people = load<Person[]>("people.json");
export const departments = load<Department[]>("departments.json");
export const budgets = load<Budget[]>("budgets.json");
export const vendors = load<Vendor[]>("vendors.json");
export const policies = load<Policy[]>("policies.json");
export const edges = load<OrgEdge[]>("edges.json");

export const getPerson = (id: string) => people.find((p) => p.id === id);
export const getDepartment = (id: string) => departments.find((d) => d.id === id);
export const getEdges = (taskType: string) => edges.filter((e) => e.task_type === taskType);
