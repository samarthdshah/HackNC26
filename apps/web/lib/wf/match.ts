// Lagoon's simple matcher (Mycelium v1). Three kinds of topic around the viewer:
//   team      people who share one of my skills
//   query     open requests of the same type (more than one person waiting on the same thing)
//   resource  room time someone booked but won't use (POL-ROOM-1)
// Intros are sent immediately; the consent version is in ideas.md.

import type { Booking, Hop, Request, WfMatch, WfPerson, WfTopic } from "@wayfinder/shared";
import { firstName, taskLabel } from "./format";

interface Input {
  me: WfPerson;
  people: WfPerson[];
  requests: Request[];
  hops: Hop[];
  bookings: Booking[];
  name: (id: string) => string;
  time: (iso: string) => string;
}

export function matchTopics({ me, people, requests, hops, bookings, name, time }: Input): { topics: WfTopic[]; matches: WfMatch[] } {
  const topics: WfTopic[] = [];
  const others = people.filter((p) => p.id !== me.id);

  // Shared skills: one topic per skill of mine that someone else has.
  for (const skill of me.skills) {
    const who = others.filter((p) => p.skills.includes(skill));
    if (!who.length) continue;
    const scored = who.map((p) => ({
      id: p.id,
      score: 0.5 + 0.1 * p.skills.filter((s) => me.skills.includes(s)).length + (p.dept === me.dept ? 0.1 : 0),
    })).sort((a, b) => b.score - a.score);
    topics.push({
      topic: skill, kind: "team",
      why: `${scored.length === 1 ? firstName(name(scored[0].id)) + " also works" : `${scored.length} people also work`} on ${skill}.`,
      ids: scored.map((s) => s.id), score: Math.min(0.99, scored[0].score),
    });
  }

  // Open requests by type: the people asking, and whoever holds each one now.
  const open = requests.filter((r) => r.status === "open" || r.status === "stuck");
  const byType = new Map<string, Request[]>();
  for (const r of open) byType.get(r.task_type)?.push(r) ?? byType.set(r.task_type, [r]);
  for (const [type, rs] of byType) {
    const holders = rs.map((r) => hops.filter((h) => h.request_id === r.id).sort((a, b) => b.seq - a.seq)[0]?.to).filter((x): x is string => !!x && x.startsWith("p_"));
    const ids = [...new Set([...rs.map((r) => r.requester_id), ...holders])].filter((id) => id !== me.id);
    const mineToo = rs.some((r) => r.requester_id === me.id);
    if (!ids.length || (!mineToo && new Set(rs.map((r) => r.requester_id)).size < 2)) continue;
    topics.push({
      topic: taskLabel(type).toLowerCase(), kind: "query",
      why: `${rs.length} open ${taskLabel(type).toLowerCase()} request${rs.length > 1 ? "s" : ""}${mineToo ? ", including yours" : ""}. Same ask, same people.`,
      ids, score: mineToo ? 0.9 : 0.7, request_ids: rs.map((r) => r.id),
    });
  }

  // Unused room time.
  for (const b of bookings.filter((b) => b.status === "partially_used" && b.used_until)) {
    const room = name(b.room_id);
    topics.push({
      topic: room, kind: "resource",
      why: `${firstName(name(b.booked_by))} booked ${room} until ${time(b.end)} but only needs it until ${time(b.used_until!)}.`,
      ids: [b.booked_by].filter((id) => id !== me.id), score: 0.8,
    });
  }

  topics.sort((a, b) => b.score - a.score || b.ids.length - a.ids.length);
  // One pair per topic keeps the Roots story ("Mycelium found a match") working.
  const matches: WfMatch[] = topics.filter((t) => t.ids.length).map((t) => ({ a: me.id, b: t.ids[0], kind: t.kind, why: t.why, score: t.score, topic: t.topic }));
  return { topics, matches };
}
