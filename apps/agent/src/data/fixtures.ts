// The agent's in-memory org data. Starts from Lane C's JSON fixtures (data/fixtures)
// and is replaced from Snowflake PHOTON.ORG at startup by loadOrgData() (data/org.ts).
// Everything else imports from here; ES module live bindings carry the swap.

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

export interface Room {
  id: string;
  name: string;
  floor: number;
  capacity: number;
  features: string[];
}

export let company = load<Company>("company.json");
export let people = load<Person[]>("people.json");
export let departments = load<Department[]>("departments.json");
export let budgets = load<Budget[]>("budgets.json");
export let vendors = load<Vendor[]>("vendors.json");
export let policies = load<Policy[]>("policies.json");
export let rooms = load<Room[]>("rooms.json");
/** Chart edges seed the org map; live edges are owned by org/map.ts. */
export const edges = load<OrgEdge[]>("edges.json");
/** Person id -> Snowflake tier role (PHOTON.ORG.PERSON_ROLES). Empty until loaded. */
export let personRoles: Record<string, string> = {};
export let source: "fixtures" | "snowflake" = "fixtures";

export interface OrgData {
  company: Company;
  people: Person[];
  departments: Department[];
  budgets: Budget[];
  vendors: Vendor[];
  policies: Policy[];
  rooms: Room[];
  personRoles: Record<string, string>;
}

export function setOrgData(data: OrgData) {
  ({ company, people, departments, budgets, vendors, policies, rooms, personRoles } = data);
  source = "snowflake";
}

export const getPerson = (id: string) => people.find((p) => p.id === id);
export const getDepartment = (id: string) => departments.find((d) => d.id === id);
export const getEdges = (taskType: string) => edges.filter((e) => e.task_type === taskType);
