// Phone calls to vendors.
// Live: ElevenLabs Conversational AI places an outbound call through an imported
// phone number, then we poll for the transcript.
// Role-played: when no phone setup exists, a caller agent and a vendor-persona
// agent talk turn by turn on Gemini. Results are labelled `live: false`.

import { ask } from "../brain/gemini.ts";
import { env, required } from "../env.ts";
import type { Vendor } from "../data/fixtures.ts";

const BASE = "https://api.elevenlabs.io/v1";

export interface CallTranscript {
  live: boolean;
  call_id: string;
  transcript: { role: "agent" | "vendor"; text: string }[];
}

export const liveCallsConfigured = () => Boolean(env.calls.agentId && env.calls.phoneNumberId && env.calls.vendorPhone);

async function el<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "xi-api-key": required("ELEVENLABS_API_KEY"), "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`ElevenLabs ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

async function liveCall(brief: string, opener: string): Promise<CallTranscript> {
  const started = await el<{ conversation_id: string }>("/convai/twilio/outbound-call", {
    method: "POST",
    body: JSON.stringify({
      agent_id: env.calls.agentId,
      agent_phone_number_id: env.calls.phoneNumberId,
      to_number: env.calls.vendorPhone,
      // Requires "allow overrides" for prompt and first message on the agent.
      conversation_initiation_client_data: {
        conversation_config_override: { agent: { prompt: { prompt: brief }, first_message: opener } },
      },
    }),
  });
  const id = started.conversation_id;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const c = await el<{ status: string; transcript?: { role: string; message?: string }[] }>(`/convai/conversations/${id}`);
    if (c.status === "done" || c.status === "failed") {
      return {
        live: true,
        call_id: id,
        transcript: (c.transcript ?? [])
          .filter((t) => t.message)
          .map((t) => ({ role: t.role === "agent" ? "agent" : "vendor", text: t.message! })),
      };
    }
  }
  throw new Error(`call ${id} did not finish within 5 minutes`);
}

async function rolePlayedCall(brief: string, opener: string, vendor: Vendor): Promise<CallTranscript> {
  const transcript: CallTranscript["transcript"] = [{ role: "agent", text: opener }];
  const vendorPersona = `You are ${vendor.contact_name} at ${vendor.name} answering the phone. Facts you know: ${vendor.pricing} Lead time ${vendor.lead_time_hours} hours. Payment: ${vendor.payment_methods.join(", ")}. Be brief and realistic; confirm orders you can fulfil, flag anything you can't. One or two sentences per turn.`;
  const callerPersona = `You are Wayfinder calling ${vendor.name} on behalf of a company. ${brief} One or two sentences per turn. When everything is confirmed, thank them and end with the word [END].`;
  const render = () => transcript.map((t) => `${t.role === "agent" ? "Wayfinder" : vendor.contact_name}: ${t.text}`).join("\n");

  for (let turn = 0; turn < 5; turn++) {
    transcript.push({ role: "vendor", text: await ask(`Call so far:\n${render()}\n\nYour reply:`, vendorPersona) });
    const next = await ask(`Call so far:\n${render()}\n\nYour reply:`, callerPersona);
    transcript.push({ role: "agent", text: next.replace("[END]", "").trim() });
    if (next.includes("[END]")) break;
  }
  return { live: false, call_id: `roleplay_${Date.now().toString(36)}`, transcript };
}

export async function placeCall(brief: string, opener: string, vendor: Vendor): Promise<CallTranscript> {
  return liveCallsConfigured() ? liveCall(brief, opener) : rolePlayedCall(brief, opener, vendor);
}
