// Every side effect the agent takes goes through emit(). Events land in a local
// JSONL file and in Tiger Data (when its tables exist); Lane B's live push
// subscribes with onLiveUpdate().

import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { logFile } from "./logs.ts";
import type { Event, LiveUpdate, OrgEdge } from "@wayfinder/shared";
import { writeEdge, writeEvent, type EdgeChange } from "./data/tiger.ts";


type Listener = (update: LiveUpdate, id: string) => void;
const listeners = new Set<Listener>();

/** Changes when the agent restarts, so a reconnecting browser knows its replay gap can't be filled. */
export const BOOT_ID = randomUUID().slice(0, 8);
const BUFFER = 500;
const recent: { id: string; update: LiveUpdate }[] = [];
let n = 0;

/** Subscribe to live updates (Lane B's push transport hooks in here). Each update has an SSE id. */
export function onLiveUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Updates after `lastId` for an SSE reconnect (Last-Event-ID), or "gap" if they can't be replayed. */
export function since(lastId: string): { id: string; update: LiveUpdate }[] | "gap" {
  const [boot, num] = lastId.split(":");
  if (boot !== BOOT_ID) return "gap";
  const from = Number(num);
  if (recent.length && from < Number(recent[0].id.split(":")[1]) - 1) return "gap";
  return recent.filter((r) => Number(r.id.split(":")[1]) > from);
}

function publish(update: LiveUpdate) {
  const id = `${BOOT_ID}:${++n}`;
  recent.push({ id, update });
  if (recent.length > BUFFER) recent.shift();
  for (const listener of listeners) listener(update, id);
}

export function emit(
  type: string,
  actor: string,
  payload: Record<string, unknown> = {},
  extra: Pick<Event, "request_id" | "tool"> = {},
): Event {
  const event: Event = { id: randomUUID(), ts: new Date().toISOString(), type, actor, payload, ...extra };
  appendFileSync(logFile("events.jsonl"), JSON.stringify(event) + "\n");
  writeEvent(event);
  publish({ kind: "event", ts: event.ts, data: event });
  return event;
}

/** An org map edge was created or changed. */
export function emitEdge(edge: OrgEdge, change: EdgeChange) {
  const ts = new Date().toISOString();
  appendFileSync(logFile("edges.jsonl"), JSON.stringify({ ts, ...edge, ...change }) + "\n");
  writeEdge(edge, change);
  publish({ kind: "edge", ts, data: edge });
}
