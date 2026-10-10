// The Q&A agent: answers questions about the org with a Gemini tool loop over
// read-only tools. Anything that needs doing goes to the coordinator instead.

import { z } from "zod";
import { company, getPerson, people, policies } from "../data/fixtures.ts";
import { describePerson, nameOf, resolveEntity } from "../org/entities.ts";
import { checkPermission } from "../tools/permission.ts";
import { route } from "../tools/route.ts";
import { listRequests, snapshot } from "../graph/runner.ts";
import { newHireSetup, requestHistory } from "../data/insights.ts";
import { taskTypes } from "../org/map.ts";
import { toolLoop, type LoopTool } from "./gemini.ts";

function tools(asker: string): LoopTool[] {
  return [
    {
      name: "lookup_person",
      description: "Find a person or team by name and return role, team, status and delegate.",
      parameters: z.object({ name: z.string() }),
      run: ({ name }) => {
        const id = resolveEntity(String(name));
        const p = id ? getPerson(id) : undefined;
        if (p) return describePerson(p);
        if (id) return `${nameOf(id)} (${id}): members ${people.filter((x) => x.department_id === id).map((x) => x.name).join(", ")}`;
        return "no match";
      },
    },
    {
      name: "route",
      description: `Who currently handles a task type. Task types: ${taskTypes().join(", ")}`,
      parameters: z.object({ task_type: z.string() }),
      run: ({ task_type }) => {
        const r = route({ task_type: String(task_type), requester: asker });
        return { ...r, owner: r.owner && nameOf(r.owner), chain: r.chain.map(nameOf), delegated_from: r.delegated_from && nameOf(r.delegated_from) };
      },
    },
    {
      name: "check_permission",
      description: "Who must approve a purchase of a given amount for a person (defaults to the asker).",
      parameters: z.object({ action: z.string(), amount_usd: z.number(), person: z.string().optional() }),
      run: ({ action, amount_usd, person }) => {
        const r = checkPermission({ person: resolveEntity(person as string) ?? asker, action: String(action), amount_usd: Number(amount_usd) });
        return { ...r, approvers: r.approvers.map(nameOf) };
      },
    },
    {
      name: "search_policy",
      description: "Search the policy handbook by keywords.",
      parameters: z.object({ query: z.string() }),
      run: ({ query }) => {
        const words = String(query).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
        return policies
          .map((p) => ({ p, score: words.filter((w) => `${p.title} ${p.text}`.toLowerCase().includes(w)).length }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(({ p }) => `[${p.id}] ${p.title}: ${p.text}`);
      },
    },
    {
      name: "new_hire_setup_metrics",
      description:
        "Why new hires take long to get set up: average days and hops for the last 10 onboardings, which departments bounce requests, " +
        "and the slowest handoffs. Runs in Snowflake as the asker's role; VP-only.",
      parameters: z.object({}),
      run: () => newHireSetup(asker),
    },
    {
      name: "request_history",
      description: "Resolved request counts, average hours and hops by task type, from Snowflake as the asker's role (managers and up).",
      parameters: z.object({ task_type: z.string().optional() }),
      run: ({ task_type }) => requestHistory(asker, task_type as string | undefined),
    },
    {
      name: "my_requests",
      description: "The asker's live requests and where each one stands.",
      parameters: z.object({}),
      run: async () => {
        const mine = listRequests().filter((r) => r.requester === asker);
        return Promise.all(
          mine.map(async (r) => {
            const s = await snapshot(r.id);
            return { id: r.id, title: s?.request.title ?? r.goal, outcome: s?.outcome, steps: s?.steps.map((x) => `${x.description} [${x.status}${x.owner ? `, ${nameOf(x.owner)}` : ""}]`) };
          }),
        );
      },
    },
  ];
}

export async function answer(asker: string, question: string): Promise<string> {
  const me = getPerson(asker);
  const system = `You are Wayfinder, ${company.name}'s internal coordinator, answering in iMessage.
The asker is ${me ? describePerson(me) : asker}. Today is ${new Date().toISOString().slice(0, 10)}.
Use tools for facts; never guess names, numbers or policies. Answer in 1-3 short sentences, plain text, cite policy ids when relevant.
For metrics, give the headline number, then the biggest cause with its share of time. For new-hire setup, also name the
department that bounces requests most and where it sends them.
If a tool returns refused: true, Snowflake denied the asker's role. Say so plainly (e.g. "Snowflake doesn't give your role access
to that"), never hint at the numbers, and suggest asking their manager. The data is simulated; say so only if asked.`;
  const { text } = await toolLoop(question, tools(asker), system);
  return text;
}
