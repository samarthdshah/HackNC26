// Room agent: makes sure a room is free for a step, freeing unused booked time
// per POL-ROOM-1. The booking itself stays with Workplace (a later action step);
// the agent's Tiger login can update bookings but not create them.
//
//   resolve ─▶ check ─┬─▶ END              (free, or a free alternative that fits)
//                     ├─▶ release ─▶ END   (unused tail ≥ 30 min: released, booker told)
//                     └─▶ END failed       (taken and nothing else fits)

import { Annotation, Command, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { askJson } from "../../brain/gemini.ts";
import { overlapping, releaseUnused, type Booking } from "../../data/bookings.ts";
import { company, rooms, type Room } from "../../data/fixtures.ts";
import { postWarRoom, sendTo } from "../../messenger.ts";
import { firstName, isSensitive, nameOf } from "../../org/entities.ts";
import { agentBase, last } from "../state.ts";
import { ev, fromBriefing, tell } from "./common.ts";

const MIN_RELEASE_MIN = 30; // POL-ROOM-1

interface Need {
  room?: Room;
  start: string;
  end: string;
  attendees: number;
  catering: boolean;
}

const RoomState = Annotation.Root({
  ...agentBase,
  need: last<Need | null>(null),
  conflicts: last<Booking[]>([]),
});
type S = typeof RoomState.State;

/** "2026-10-10" + "12:00" in the company's timezone -> ISO with offset. */
function zoned(date: string, hm: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, timeZoneName: "longOffset" }).formatToParts(
    new Date(`${date}T12:00:00Z`),
  );
  const offset = parts.find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "+00:00";
  return `${date}T${hm.padStart(5, "0")}:00${offset}`;
}

const clock = (isoTime: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(isoTime));

const fits = (r: Room, n: Need) => r.capacity >= n.attendees && (!n.catering || r.features.includes("catering allowed"));

async function resolve(s: S): Promise<Command> {
  const headcount = fromBriefing(s.briefing, "headcount");
  const want = await askJson(
    `Step: ${s.step.description}\nRequest: ${s.request.goal}\n${s.briefing ? `Known so far:\n${s.briefing}\n` : ""}` +
      `Today is ${company.demo_date} (${company.timezone}). Rooms:\n` +
      rooms.map((r) => `${r.id} ${r.name}: ${r.capacity} seats, ${r.features.join(", ")}`).join("\n"),
    z.object({
      room_id: z.string().optional().describe("Only if a specific room is named or required"),
      date: z.string().describe("YYYY-MM-DD; today if not stated"),
      start: z.string().describe("HH:MM 24h"),
      end: z.string().describe("HH:MM 24h; one hour after start if not stated"),
      attendees: z.number().describe("Expected people; use the headcount if known"),
      catering: z.boolean().describe("Food will be served"),
    }),
    "Extract the room booking need. Do not invent a room unless one is named or only one can work.",
  );
  const need: Need = {
    room: rooms.find((r) => r.id === want.room_id),
    start: zoned(want.date, want.start),
    end: zoned(want.date, want.end),
    attendees: headcount ?? want.attendees,
    catering: want.catering,
  };
  need.room ??= rooms.filter((r) => fits(r, need)).sort((a, b) => a.capacity - b.capacity)[0];
  if (!need.room) {
    return new Command({
      update: { result: { status: "failed", summary: `No room seats ${need.attendees}${need.catering ? " with catering allowed" : ""}` } },
      goto: END,
    });
  }
  return new Command({ update: { need }, goto: "check" });
}

async function check(s: S): Promise<Command> {
  const n = s.need!;
  const room = n.room!;
  const window = `${clock(n.start)}–${clock(n.end)}`;
  const taken = await overlapping(room.id, n.start, n.end);
  ev(s, "room_checked", { room_id: room.id, start: n.start, end: n.end, conflicts: taken.map((b) => b.id) });

  if (taken.length === 0) return done(s, room, `${room.name} is free ${window}`);

  // Unused tail of a partially used booking that covers our window can be released.
  const releasable = (b: Booking) =>
    b.status === "partially_used" &&
    b.used_until !== null &&
    Date.parse(b.used_until) <= Date.parse(n.start) &&
    (Date.parse(b.end) - Date.parse(b.used_until)) / 60_000 >= MIN_RELEASE_MIN;
  if (taken.every(releasable)) return new Command({ update: { conflicts: taken }, goto: "release" });

  for (const alt of rooms.filter((r) => r.id !== room.id && fits(r, n))) {
    if ((await overlapping(alt.id, n.start, n.end)).length === 0) {
      return done(s, alt, `${room.name} is booked ${window}; ${alt.name} (${alt.capacity} seats) is free instead`);
    }
  }
  const by = taken.map((b) => `${nameOf(b.booked_by)}'s "${b.title}"`).join(", ");
  return new Command({
    update: { result: { status: "failed", summary: `${room.name} is taken ${window} (${by}) and no other room fits` } },
    goto: END,
  });
}

async function release(s: S): Promise<Command> {
  const n = s.need!;
  const freed: string[] = [];
  for (const b of s.conflicts) {
    const window = await releaseUnused(b.id);
    if (!window) continue;
    freed.push(b.id);
    const span = `${clock(window.from)}–${clock(window.to)}`;
    ev(s, "booking_released", { booking_id: b.id, room_id: b.room_id, booked_by: b.booked_by, from: window.from, to: window.to });
    await sendTo(
      b.booked_by,
      `FYI: your "${b.title}" in ${n.room!.name} wrapped at ${clock(window.from)}, so I released the unused ${span} for ${nameOf(s.request.requester)} (POL-ROOM-1).`,
      s.request.id,
    );
    await postWarRoom(`🏢 Released ${span} of ${firstName(b.booked_by)}'s ${n.room!.name} booking`, s.request.id, isSensitive(s.request.task_type));
  }
  if (freed.length !== s.conflicts.length) {
    return new Command({ update: { result: { status: "failed", summary: `Couldn't release ${n.room!.name}` } }, goto: END });
  }
  const who = [...new Set(s.conflicts.map((b) => firstName(b.booked_by)))].join(" and ");
  return done(s, n.room!, `${n.room!.name} is free ${clock(n.start)}–${clock(n.end)}: released the unused end of ${who}'s booking`, freed);
}

function done(s: S, room: Room, summary: string, released: string[] = []): Command {
  const n = s.need!;
  return new Command({
    update: {
      result: {
        status: "done",
        summary,
        data: { room_id: room.id, room: room.name, start_at: n.start, end_at: n.end, attendees: n.attendees, released },
      },
    },
    goto: "announce",
  });
}

async function announce(s: S) {
  await tell(s, `🏢 ${s.result!.summary}.`);
  return {};
}

export const buildRoomAgent = () =>
  new StateGraph(RoomState)
    .addNode("resolve", resolve, { ends: ["check", END] })
    .addNode("check", check, { ends: ["release", "announce", END] })
    .addNode("release", release, { ends: ["announce", END] })
    .addNode("announce", announce)
    .addEdge(START, "resolve")
    .addEdge("announce", END);
