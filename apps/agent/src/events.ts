// Every side effect the agent takes goes through emit(). For now events land in a
// local JSONL file; Tiger Data (Lane C) and the website push (Lane B) plug in here.

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Event, LiveUpdate, OrgEdge } from "@wayfinder/shared";

const logDir = fileURLToPath(new URL("../logs/", import.meta.url));
mkdirSync(logDir, { recursive: true });

type Listener = (update: LiveUpdate) => void;
const listeners = new Set<Listener>();

/** Subscribe to live updates (Lane B's push transport hooks in here). */
export function onLiveUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(update: LiveUpdate) {
  for (const listener of listeners) listener(update);
}

export function emit(
  type: string,
  actor: string,
  payload: Record<string, unknown> = {},
  extra: Pick<Event, "request_id" | "tool"> = {},
): Event {
  const event: Event = { id: randomUUID(), ts: new Date().toISOString(), type, actor, payload, ...extra };
  appendFileSync(logDir + "events.jsonl", JSON.stringify(event) + "\n");
  publish({ kind: "event", ts: event.ts, data: event });
  return event;
}

/** An org map edge was created or changed. */
export function emitEdge(edge: OrgEdge) {
  const ts = new Date().toISOString();
  appendFileSync(logDir + "edges.jsonl", JSON.stringify({ ts, ...edge }) + "\n");
  publish({ kind: "edge", ts, data: edge });
}
