// Summaries, written to be heard: one for a person (/summary in chat) and one for a
// single request (POST /summary, the Summary button on the website's Currents page).

import type { SummaryRequest } from "@wayfinder/shared";
import { company, getPerson } from "../data/fixtures.ts";
import { listRequests, snapshot, waitingOn } from "../graph/runner.ts";
import { nameOf } from "../org/entities.ts";
import { ask } from "./gemini.ts";

const STYLE = "You are AVATAR, an internal coordinator, speaking a summary out loud. Plain sentences, no lists, no markdown, no emoji.";

/** What's going on for one person: their requests and what's waiting on them. */
export async function summarizeFor(personId: string): Promise<string> {
  const me = getPerson(personId);
  const waiting = waitingOn(personId).map((p) => `${p.kind}: ${p.summary}`);
  const mine = await Promise.all(
    listRequests()
      .filter((r) => r.requester === personId)
      .map(async (r) => {
        const s = await snapshot(r.id);
        const steps = s?.steps.map((x) => `${x.description} [${x.status}${x.owner ? `, ${nameOf(x.owner)}` : ""}]`).join("; ");
        return `${s?.request.title ?? r.goal} → ${s?.outcome ?? "open"}${steps ? `: ${steps}` : ""}`;
      }),
  );
  if (!waiting.length && !mine.length) return `Nothing's in flight for you right now, ${me?.name.split(" ")[0] ?? "there"}. Text me a goal and I'll get it moving.`;
  return ask(
    `Summarise for ${me?.name} (${me?.role}) at ${company.name}.\nWaiting on them:\n${waiting.join("\n") || "nothing"}\n` +
      `Their requests (newest last):\n${mine.join("\n") || "none"}\n\nIn 3 or 4 sentences: what needs their action first, then where each request stands and who has it.`,
    STYLE,
  );
}

/** One request, from what the website shows: what it was, where it went, where it stands. */
export async function summarizeRequest(r: SummaryRequest): Promise<string> {
  const trail = r.steps.slice(-30).map((s) => `${s.at ? `[${s.at}] ` : ""}${s.who} (${s.kind}): ${s.text}`).join("\n");
  return ask(
    `Request: "${r.title}"${r.requester ? ` from ${r.requester}` : ""}. Status: ${r.status}.\nWhat happened, oldest first:\n${trail || "no messages yet"}\n\n` +
      "In 2 or 3 sentences: what was asked, who it passed through (name any bounce or hand-off), and where it stands now.",
    STYLE,
  );
}
