// Auto-replies for the cast while you drive one persona from your phone. Follows the agent's
// live feed and answers each ask (RSVP, approval, task) as the person asked, through POST /say.
// People bound to a phone are skipped, so your own persona is always left to you.
// Run: npm run autoreply -w @wayfinder/agent -- lunch [--delay 2500] [--skip p_sam,p_nina]
// Scenarios: demo (all three demos, any order, repeatable), auto (defaults only), lunch, transfer,
// leo, outage, room, leave, dock.

import type { Event, LiveUpdate } from "@wayfinder/shared";
import { env } from "../src/env.ts";

type Kind = "rsvp" | "approval" | "task";
// task: replies used in order. byTask: a reply per task_type ("*" for any other), never used up.
type Lines = { rsvp?: string; approval?: string; task?: string[]; byTask?: Record<string, string> };

const DEFAULTS: Record<Kind, string> = { rsvp: "yes", approval: "approve", task: "done" };

const SCENARIOS: Record<string, Record<string, Lines>> = {
  demo: {
    p_victor: { rsvp: "yes!" },
    p_leo: { rsvp: "yes, thank you!" },
    p_sam: { rsvp: "count me in" },
    p_nina: { rsvp: "count me in", approval: "approve" },
    p_dana: { approval: "approve" },
    p_maya: { approval: "approved" },
    p_hannah: { approval: "approved" },
    p_luis: { byTask: { "*": "done, it's booked" } },
    p_raj: { byTask: { data_access: "not us, analyst access is Analytics Engineering", "*": "fixed, backfill is running" } },
    p_tom: { byTask: { "*": "done, granted the ANALYST role" } },
    p_elena: { byTask: { "*": "I'm heads down on a migration today, Raj can cover this one" } },
    p_andre: { byTask: { "*": "done, approved and logged in the leave system" } },
  },
  auto: {},
  lunch: {
    p_victor: { rsvp: "yes!" },
    p_leo: { rsvp: "yes, thank you!" },
    p_nina: { rsvp: "count me in", approval: "approve" },
    p_luis: { task: ["done, booked The Commons Tuesday 12-1 for Leo's welcome lunch"] },
  },
  transfer: { p_maya: { approval: "approved" }, p_hannah: { approval: "approved" } },
  leo: {
    p_raj: { task: ["not us, analyst access is Analytics Engineering"] },
    p_tom: { task: ["done, granted the ANALYST role"] },
  },
  outage: {
    p_elena: { task: ["I'm heads down on a migration today, Raj can cover this one"] },
    p_raj: { task: ["fixed, backfill is running"] },
  },
  room: { p_luis: { task: ["done, booked the Commons 12-1 for Nina"] } },
  leave: { p_andre: { task: ["done, approved and logged in the leave system"] } },
  dock: { p_dana: { approval: "approved" } },
};

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const delayMs = Number(flag("delay") ?? process.env.REPLY_DELAY_MS ?? 2500);
const skip = new Set((flag("skip") ?? "").split(",").filter(Boolean));
const scenario = args[0] ?? "demo";
if (!SCENARIOS[scenario]) {
  console.error(`Unknown scenario "${scenario}". Try: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}
// Copy the task queues so they can be consumed in order.
const cast: Record<string, Lines> = Object.fromEntries(
  Object.entries(SCENARIOS[scenario]).map(([id, l]) => [id, { ...l, task: l.task && [...l.task] }]),
);

const base = `http://localhost:${env.port}`;
const auth: Record<string, string> = env.webToken ? { Authorization: `Bearer ${env.webToken}` } : {};
const name = (id: string) => id.replace(/^p_/, "").replace(/^./, (c) => c.toUpperCase());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let bound = new Set<string>();
async function refreshBound() {
  try {
    const health = (await (await fetch(`${base}/health`)).json()) as { bound?: string[] };
    bound = new Set(health.bound ?? []);
  } catch {
    // keep the last known list
  }
}

function lineFor(person: string, kind: Kind, taskType?: string): string {
  const l = cast[person];
  if (kind === "task") return l?.task?.shift() ?? (taskType && l?.byTask?.[taskType]) ?? l?.byTask?.["*"] ?? DEFAULTS.task;
  return l?.[kind] ?? DEFAULTS[kind];
}

async function reply(person: string, kind: Kind, requestId: string | undefined, taskType?: string) {
  await refreshBound();
  if (bound.has(person) || skip.has(person)) return;
  const text = lineFor(person, kind, taskType);
  await sleep(delayMs);
  try {
    const res = await fetch(`${base}/say`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ as: person, text, request_id: requestId }),
    });
    const time = new Date().toLocaleTimeString();
    console.log(res.ok ? `${time}  ${name(person)}: ${text}` : `${time}  ${name(person)} failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`[autoreply] /say as ${person} failed: ${err}`);
  }
}

const seen = new Set<string>();
const pendingTasks = new Map<string, string | undefined>(); // "owner|request" -> task_type, until the ask goes out
function onEvent(e: Event) {
  if (seen.has(e.id)) return;
  seen.add(e.id);
  const p = e.payload;
  if (e.type === "identity_bound") void refreshBound();
  else if (e.type === "rsvp_opened") for (const id of (p.invitees as string[]) ?? []) void reply(id, "rsvp", e.request_id);
  else if (e.type === "approval_requested" && typeof p.approver === "string") void reply(p.approver, "approval", e.request_id);
  // A task is drafted after "routed", so wait for the ask itself (a message to the owner on that request)
  // before replying. Replying earlier lands as small talk and the step keeps waiting.
  else if (e.type === "routed" && typeof p.owner === "string") pendingTasks.set(`${p.owner}|${e.request_id}`, typeof p.task_type === "string" ? p.task_type : undefined);
  else if (e.type === "message_out" && typeof p.to === "string") {
    const key = `${p.to}|${e.request_id}`;
    if (pendingTasks.has(key)) {
      const taskType = pendingTasks.get(key);
      pendingTasks.delete(key);
      void reply(p.to, "task", e.request_id, taskType);
    }
  }
}

/** Reads the SSE stream until it drops. Replays from the last id after a reconnect. */
let lastId = "";
async function follow() {
  const res = await fetch(`${base}/live`, { headers: { Accept: "text/event-stream", ...auth, ...(lastId ? { "Last-Event-ID": lastId } : {}) } });
  if (!res.ok || !res.body) throw new Error(`GET /live: ${res.status}`);
  console.log(`[autoreply] following ${base}/live · scenario ${scenario} · ${delayMs} ms delay`);
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, end);
      buf = buf.slice(end + 2);
      let event = "message", data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
        else if (line.startsWith("id: ")) lastId = line.slice(4);
      }
      if (event !== "update" || !data) continue;
      const u = JSON.parse(data) as LiveUpdate;
      if (u.kind === "event") onEvent(u.data);
    }
  }
}

await refreshBound();
for (;;) {
  try {
    await follow();
    console.warn("[autoreply] stream ended, reconnecting");
  } catch (err) {
    console.warn(`[autoreply] ${err instanceof Error ? err.message : err}, retrying in 2 s`);
  }
  await sleep(2000);
}
