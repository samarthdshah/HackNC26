// Routing hops for Lane C's events trigger (data/tiger/SCHEMA.md, "Live path").
// One `hop` event when the person who received a request acts on it, in seq order
// per request. `from` is the previous hop's `to` (the requester for hop 1). The
// trigger turns these into request_hops rows, which Insights and Darwin read.
// Specialist agents for the same request run in parallel, so seq lives here,
// persisted so a restart continues the numbering.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { logFile } from "../logs.ts";
import { emit } from "../events.ts";

export type HopOutcome = "forwarded" | "bounced" | "delegated" | "handled";

const file = logFile("hops.json");
const state: Record<string, { seq: number; last: string }> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

const isActor = (id: string | undefined): id is string => Boolean(id && /^(p_|dept_)/.test(id));

export function recordHop(
  requestId: string,
  requester: string,
  to: string,
  outcome: HopOutcome,
  opts: { redirect_to?: string; note?: string } = {},
) {
  if (!isActor(to)) return;
  const prev = state[requestId];
  const seq = (prev?.seq ?? 0) + 1;
  const from = prev?.last ?? requester;
  state[requestId] = { seq, last: to };
  writeFileSync(file, JSON.stringify(state));
  emit(
    "hop",
    to,
    {
      request_id: requestId,
      seq,
      from,
      to,
      outcome,
      ...(isActor(opts.redirect_to) && { redirect_to: opts.redirect_to }),
      note: opts.note ?? outcome,
    },
    { request_id: requestId },
  );
}

export function resetHops() {
  for (const k of Object.keys(state)) delete state[k];
  writeFileSync(file, "{}");
}
