// Who is on the other end of a chat. Teammates claim a persona with `/iam tom`
// from their phone; in the terminal `/as tom` switches persona so one person can
// play every role. Bindings persist to logs/contacts.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Handle {
  platform: string; // "imessage" | "terminal"
  id: string; // phone/email for iMessage, sender id for terminal
}

const file = fileURLToPath(new URL("../../logs/contacts.json", import.meta.url));
const key = (h: Handle) => `${h.platform}:${h.id}`;

// person id -> handle
let bindings: Record<string, Handle> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const save = () => writeFileSync(file, JSON.stringify(bindings, null, 1));

export function personFor(handle: Handle): string | undefined {
  return Object.entries(bindings).find(([, h]) => key(h) === key(handle))?.[0];
}

export function handleFor(personId: string): Handle | undefined {
  return bindings[personId];
}

/** Bind a handle to a person. A handle plays one persona at a time. */
export function bind(personId: string, handle: Handle) {
  for (const [pid, h] of Object.entries(bindings)) if (key(h) === key(handle)) delete bindings[pid];
  bindings[personId] = handle;
  save();
}

export function allBindings(): Readonly<Record<string, Handle>> {
  return bindings;
}

export function resetDirectory() {
  bindings = {};
  save();
}
