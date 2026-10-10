// draft: write the actual text a person receives.

import type { ToolIO } from "@wayfinder/shared";
import { ask } from "../brain/gemini.ts";
import { getPerson } from "../data/fixtures.ts";
import { describePerson } from "../org/entities.ts";

type In = ToolIO["draft"]["input"];

const SYSTEM = `You write iMessages for Wayfinder, a friendly internal coordinator.
Rules: 1 to 3 short sentences, plain text, no markdown, no greeting fluff, no sign-off.
Address the recipient by first name. Say exactly what you need from them and how to reply.`;

export async function draft({ to, intent, context }: In): Promise<{ text: string }> {
  const person = getPerson(to);
  const prompt = [
    `Recipient: ${person ? describePerson(person) : to}`,
    `What the message must do: ${intent}`,
    context && `Context:\n${context}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { text: await ask(prompt, SYSTEM) };
}
