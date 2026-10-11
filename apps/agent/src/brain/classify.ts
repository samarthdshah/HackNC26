// Reads a reply from an owner or approver and decides what it means.
// Exact keywords skip the model so APPROVE/DENY/DONE are instant and certain.

import { z } from "zod";
import { askJson } from "./gemini.ts";

export const ReplySchema = z.object({
  kind: z
    .enum(["done", "accept", "redirect", "delegate", "deny", "question", "other"])
    .describe(
      "done: finished or approved. accept: acknowledged, will do it. redirect: not theirs, names who owns it. " +
        "delegate: someone else should handle it on their behalf (e.g. while they're out). deny: refuses. " +
        "question: needs info before acting. other: anything else.",
    ),
  target: z.string().optional().describe("For redirect/delegate: the person or team named, as written"),
  until: z.string().optional().describe("For delegate: ISO date the delegation ends, if stated"),
  note: z.string().optional().describe("Short reason or the question being asked"),
});

export type Reply = z.infer<typeof ReplySchema>;

const DONE = /^(approve[ds]?|yes|yep|done|granted|ok(ay)?,? done|all set|handled|complete[d]?)\b/i;
const DENY = /^(deny|denied|no|reject(ed)?|decline[d]?)\b/i;

export async function classifyReply(text: string, ask: string, isApproval: boolean): Promise<Reply> {
  const t = text.trim();
  if (DONE.test(t) && t.split(/\s+/).length <= 4) return { kind: "done", note: t };
  if (DENY.test(t) && t.split(/\s+/).length <= 4) return { kind: "deny", note: t };

  return askJson(
    `The agent sent this ${isApproval ? "approval request" : "task"}:\n"${ask}"\n\nThe reply was:\n"${t}"\n\n` +
      `Today is ${new Date().toISOString().slice(0, 10)}. Classify the reply.`,
    ReplySchema,
    "You classify workplace replies precisely. If they say it isn't their area and point elsewhere, that's redirect.",
  );
}
