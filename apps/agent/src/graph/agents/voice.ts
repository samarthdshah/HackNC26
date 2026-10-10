// Voice agent: phones a vendor to place or confirm an order.
//
//   brief ─▶ call ─▶ debrief ─┬─▶ report ─▶ END
//                             └─▶ END (vendor couldn't do it: failed, with reason)
//
// brief writes the call plan from the request and earlier results (headcount,
// approved amount); call is live via ElevenLabs or role-played by two agents;
// debrief extracts what was actually agreed; report sends a voice note.

import { Annotation, Command, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { ask, askJson } from "../../brain/gemini.ts";
import type { Vendor } from "../../data/fixtures.ts";
import { postWarRoom, sendVoiceTo } from "../../messenger.ts";
import { firstName, isSensitive } from "../../org/entities.ts";
import { tts } from "../../voice/elevenlabs.ts";
import { placeCall, type CallTranscript } from "../../voice/calls.ts";
import { agentBase, last } from "../state.ts";
import { ev, tell, vendorFor } from "./common.ts";

const Debrief = z.object({
  confirmed: z.boolean().describe("Did the vendor agree to do what we asked?"),
  summary: z.string().describe("One sentence: what was agreed, when, how much"),
  quoted_usd: z.number().optional(),
  follow_ups: z.array(z.string()).describe("Anything we still owe them or must check"),
});

const VoiceState = Annotation.Root({
  ...agentBase,
  vendor: last<Vendor | null>(null),
  callPlan: last<{ brief: string; opener: string } | null>(null),
  transcript: last<CallTranscript | null>(null),
  agreed: last<z.infer<typeof Debrief> | null>(null),
});
type S = typeof VoiceState.State;

async function brief(s: S): Promise<Command> {
  const vendor = vendorFor(s.step);
  if (!vendor) {
    return new Command({ update: { result: { status: "failed", summary: "No vendor on this call step" } }, goto: END });
  }
  const plan = await askJson(
    `Prepare a phone call to ${vendor.name} (${vendor.contact_name}).\nGoal: ${s.step.description}\nRequest: ${s.request.goal}\n` +
      `${s.briefing ? `Known so far:\n${s.briefing}\n` : ""}Vendor facts: ${vendor.pricing} Lead time ${vendor.lead_time_hours}h.`,
    z.object({
      brief: z.string().describe("Instructions for the caller: what to order, quantities, timing, budget limit, what to confirm"),
      opener: z.string().describe("First sentence the caller says when they pick up"),
    }),
    "You prepare concise, specific call plans for a company assistant.",
  );
  await tell(s, `📞 Calling ${vendor.name} now…`);
  ev(s, "call_started", { vendor: vendor.id });
  return new Command({ update: { vendor, callPlan: plan }, goto: "call" });
}

async function call(s: S) {
  const transcript = await placeCall(s.callPlan!.brief, s.callPlan!.opener, s.vendor!);
  ev(s, "call_ended", { vendor: s.vendor!.id, live: transcript.live, call_id: transcript.call_id, turns: transcript.transcript.length });
  return { transcript };
}

async function debrief(s: S): Promise<Command> {
  const text = s.transcript!.transcript.map((t) => `${t.role === "agent" ? "Wayfinder" : s.vendor!.contact_name}: ${t.text}`).join("\n");
  const d = await askJson(`Call goal: ${s.step.description}\n\nTranscript:\n${text}`, Debrief, "Extract exactly what was agreed. Be strict.");
  if (!d.confirmed) {
    return new Command({
      update: { agreed: d, result: { status: "failed", summary: `${s.vendor!.name} couldn't confirm: ${d.summary}` } },
      goto: END,
    });
  }
  return new Command({ update: { agreed: d }, goto: "report" });
}

async function report(s: S) {
  const d = s.agreed!;
  const label = s.transcript!.live ? "" : " (role-played call)";
  const script = await ask(
    `Write a 2-sentence voice note to ${firstName(s.request.requester)} about a call you just made to ${s.vendor!.name}: ${d.summary}` +
      `${d.follow_ups.length ? ` Follow-ups: ${d.follow_ups.join("; ")}.` : ""}`,
    "Warm, brief, spoken style. No markdown.",
  );
  try {
    await sendVoiceTo(s.request.requester, await tts(script), script, s.request.id);
  } catch {
    await tell(s, script);
  }
  await postWarRoom(`📞 ${s.request.title}: ${s.vendor!.name} confirmed${label}. ${d.summary}`, s.request.id, isSensitive(s.request.task_type));
  return {
    result: {
      status: "done" as const,
      owner: s.vendor!.id,
      summary: `${s.vendor!.name} confirmed${label}: ${d.summary}`,
      data: { call_id: s.transcript!.call_id, live: s.transcript!.live, ...(d.quoted_usd !== undefined && { quoted_usd: d.quoted_usd }) },
    },
  };
}

export const buildVoiceAgent = () =>
  new StateGraph(VoiceState)
    .addNode("brief", brief, { ends: ["call", END] })
    .addNode("call", call)
    .addNode("debrief", debrief, { ends: ["report", END] })
    .addNode("report", report)
    .addEdge(START, "brief")
    .addEdge("call", "debrief")
    .addEdge("report", END);

