// Raw records the adapter builds WF from. Tiger and the fixtures both produce this
// shape (shared API names), so every number is computed by one code path (build.ts).

import type { Actor, Booking, Event, Hop, OrgEdge, OrgEdgeChange, Request } from "@wayfinder/shared";

export interface DirectoryPerson {
  id: string;
  name: string;
  department_id: string;
  role: string;
  manager_id: string | null;
  status: "active" | "out";
  out_until: string | null;
  delegate_id: string | null;
  skills: string[];
}
export interface DirectoryDept { id: string; name: string; head_id: string | null }
export interface Company { name: string; timezone: string; demo_date: string }

export interface RawData {
  source: "tiger" | "fixtures";
  company: Company;
  // The directory (roles, skills, out-of-office) is in Snowflake and the fixtures, not Tiger.
  people: DirectoryPerson[];
  departments: DirectoryDept[];
  actors: Actor[];
  requests: Request[];
  hops: Hop[];
  events: Event[];
  edges: OrgEdge[];
  edgeChanges: OrgEdgeChange[];
  bookings: Booking[];
  extraNames: Record<string, string>; // rooms and vendors (Snowflake/fixtures only)
}
