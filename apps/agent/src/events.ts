// Every side effect the agent takes goes through emit(). Events land in a local
// JSONL file and in Tiger Data (when its tables exist); Lane B's live push
// subscribes with onLiveUpdate().

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Event, LiveUpdate, OrgEdge } from "@wayfinder/shared";
import { writeEdge, writeEvent } from "./data/tiger.ts";

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
  writeEvent(event);
  publish({ kind: "event", ts: event.ts, data: event });
  return event;
}

/** An org map edge was created or changed. */
export function emitEdge(edge: OrgEdge, learnedFrom?: string) {
  const ts = new Date().toISOString();
  appendFileSync(logDir + "edges.jsonl", JSON.stringify({ ts, ...edge }) + "\n");
  writeEdge(edge, learnedFrom);
  publish({ kind: "edge", ts, data: edge });
}
