// Helpers shared by the specialist agents.

import { vendors, type Vendor } from "../../data/fixtures.ts";
import { emit } from "../../events.ts";
import { sendTo } from "../../messenger.ts";
import type { Request, Step } from "../state.ts";

type Ctx = { request: Request; step: Step };

export const tell = (s: Ctx, text: string) => sendTo(s.request.requester, text, s.request.id);

export const ev = (s: Ctx, type: string, payload: Record<string, unknown> = {}) =>
  emit(type, "agent", { title: s.request.title, step: s.step.id, kind: s.step.kind, ...payload }, { request_id: s.request.id });

/** Pull a number (e.g. headcount, approved amount) out of dependency results. */
export function fromBriefing(briefing: string, key: string): number | undefined {
  const m = briefing.match(new RegExp(`"${key}":\\s*(\\d+(?:\\.\\d+)?)`));
  return m ? Number(m[1]) : undefined;
}

/** The vendor a step is about: its vendor_id, else a vendor named in its description. */
export function vendorFor(step: Step): Vendor | undefined {
  const byId = vendors.find((v) => v.id === step.vendor_id);
  if (byId) return byId;
  const text = step.description.toLowerCase();
  return vendors.find((v) => text.includes(v.name.toLowerCase()) || text.includes(v.name.split(" ")[0].toLowerCase()));
}
