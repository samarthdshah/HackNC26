// Briefing agent: a short spoken rundown for one person of what's waiting on
// them and where their own requests stand, sent as an ElevenLabs voice note.

import { company, getPerson } from "../data/fixtures.ts";
import { listRequests, snapshot, waitingOn } from "../graph/runner.ts";
import { sendTo, sendVoiceTo } from "../messenger.ts";
import { nameOf } from "../org/entities.ts";
import { tts } from "../voice/elevenlabs.ts";
import { ask } from "./gemini.ts";

export async function sendBriefing(personId: string): Promise<void> {
  const me = getPerson(personId);
  const waiting = waitingOn(personId).map((p) => `${p.kind}: ${p.summary}`);
  const mine = await Promise.all(
    listRequests()
      .filter((r) => r.requester === personId)
      .map(async (r) => {
        const s = await snapshot(r.id);
        return `${s?.request.title ?? r.goal}: ${s?.outcome}; ${s?.steps.map((x) => `${x.description} [${x.status}]`).join(", ")}`;
      }),
  );
  const script = await ask(
    `Morning briefing for ${me?.name} (${me?.role}) at ${company.name}.\nWaiting on them:\n${waiting.join("\n") || "nothing"}\n` +
      `Their requests:\n${mine.join("\n") || "none"}`,
    "You are Wayfinder giving a 20-second spoken briefing. Lead with what needs their action. Warm, plain, no lists or markdown.",
  );
  try {
    await sendVoiceTo(personId, await tts(script), script);
  } catch {
    await sendTo(personId, `☀️ ${script}`);
  }
}

/** Fire a briefing at BRIEFING_AT (HH:MM local) for everyone in the list, once a day. */
export function scheduleBriefings(at: string, recipients: () => string[]) {
  let lastDay = "";
  setInterval(() => {
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);
    const day = now.toDateString();
    if (hhmm !== at || lastDay === day) return;
    lastDay = day;
    for (const p of recipients()) void sendBriefing(p).catch((e) => console.error(`[briefing] ${nameOf(p)}`, e));
  }, 30_000).unref();
}
