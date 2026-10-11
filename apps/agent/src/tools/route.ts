// route: pick who should act on a task. Follows the highest-confidence active
// edge from the agent, walks team -> person, and hands off to a delegate when
// the person is out.

import type { ToolIO } from "@wayfinder/shared";
import { getDepartment, getPerson } from "../data/fixtures.ts";
import { isTeam } from "../org/entities.ts";
import { allEdges, edgesFrom, isActive } from "../org/map.ts";

type In = ToolIO["route"]["input"];
type Out = ToolIO["route"]["output"];

/** Team -> the person on that team who handles this task type. */
function personInTeam(team: string, taskType: string, exclude: Set<string>): string | undefined {
  const viaEdge = edgesFrom(team, taskType).find((e) => !exclude.has(e.to));
  if (viaEdge) return viaEdge.to;
  // An incident landing on a team that has no route for this kind (e.g. a checkout
  // incident paged to Platform) goes to whoever takes that team's incidents: the
  // on-call (POL-INC-1/2), not the department head.
  if (taskType.endsWith("_incident")) {
    const onCall = allEdges()
      .filter((e) => e.from === team && e.task_type.endsWith("_incident") && isActive(e) && !exclude.has(e.to))
      .sort((x, y) => y.confidence - x.confidence)[0];
    if (onCall) return onCall.to;
  }
  const head = getDepartment(team)?.head_id;
  return head && !exclude.has(head) ? head : undefined;
}

/** Person -> whoever is covering for them right now, if they're out. */
function coverFor(person: string, taskType: string): string | undefined {
  const learned = edgesFrom(person, taskType).find((e) => e.delegate_until);
  if (learned) return learned.to;
  const p = getPerson(person);
  if (p?.status === "out" && p.delegate_id && (!p.out_until || new Date(p.out_until) > new Date())) return p.delegate_id;
  return undefined;
}

export function route({ task_type, exclude = [], prefer }: In): Out {
  const skip = new Set(exclude);
  const first = prefer
    ? { to: prefer, confidence: 1, source: "learned" as const }
    : edgesFrom("agent", task_type).find((e) => !skip.has(e.to));
  if (!first) return { owner: null, entry: null, chain: [], confidence: 0, source: "chart" };

  const chain = [first.to];
  let owner: string | undefined = first.to;
  if (isTeam(owner)) {
    owner = personInTeam(owner, task_type, skip);
    if (owner) chain.push(owner);
  }

  let delegated_from: string | undefined;
  const cover = owner ? coverFor(owner, task_type) : undefined;
  if (owner && cover) {
    delegated_from = owner;
    owner = cover;
    chain.push(cover);
  }

  return {
    owner: owner ?? null,
    entry: first.to,
    chain,
    confidence: first.confidence,
    source: first.source,
    ...(delegated_from && { delegated_from }),
  };
}
