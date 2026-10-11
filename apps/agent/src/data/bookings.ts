// Room bookings. Live in Tiger (Lane C's `bookings`; the agent may SELECT and UPDATE,
// not INSERT: new bookings go through Workplace per POL-ROOM-1). Without Tiger
// (sims, tests) an in-memory copy of data/fixtures/bookings.json stands in.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tigerQuery } from "./tiger.ts";

export interface Booking {
  id: string;
  room_id: string;
  booked_by: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  attendees_expected: number | null;
  status: "confirmed" | "partially_used" | "released" | "cancelled";
  used_until: string | null;
  note: string | null;
}

const fixtureFile = fileURLToPath(new URL("../../../../data/fixtures/bookings.json", import.meta.url));
let local: Booking[] = JSON.parse(readFileSync(fixtureFile, "utf8"));

const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());

/** Bookings of a room that overlap [start, end), excluding cancelled ones. */
export async function overlapping(roomId: string, start: string, end: string): Promise<Booking[]> {
  const r = await tigerQuery(
    `select id, room_id, booked_by, title, start_at, end_at, attendees_expected, status, used_until, note
     from bookings where room_id = $1 and status <> 'cancelled' and start_at < $3 and end_at > $2 order by start_at`,
    [roomId, start, end],
  );
  if (r) {
    return r.rows.map((b) => ({
      id: b.id, room_id: b.room_id, booked_by: b.booked_by, title: b.title, start: iso(b.start_at)!, end: iso(b.end_at)!,
      attendees_expected: b.attendees_expected, status: b.status, used_until: iso(b.used_until), note: b.note,
    }));
  }
  const [s, e] = [Date.parse(start), Date.parse(end)];
  return local.filter((b) => b.room_id === roomId && b.status !== "cancelled" && Date.parse(b.start) < e && Date.parse(b.end) > s);
}

/** POL-ROOM-1: give back the unused tail of a partially used booking. Returns the freed window. */
export async function releaseUnused(bookingId: string): Promise<{ from: string; to: string } | undefined> {
  const r = await tigerQuery(
    `update bookings b set end_at = b.used_until, status = 'released', released_at = now()
     from (select id, end_at as old_end from bookings where id = $1 for update) o
     where b.id = o.id and b.status = 'partially_used' and b.used_until is not null
     returning b.used_until, o.old_end`,
    [bookingId],
  );
  if (r) return r.rows[0] ? { from: iso(r.rows[0].used_until)!, to: iso(r.rows[0].old_end)! } : undefined;
  const b = local.find((x) => x.id === bookingId && x.status === "partially_used" && x.used_until);
  if (!b) return undefined;
  const freed = { from: b.used_until!, to: b.end };
  Object.assign(b, { end: b.used_until, status: "released" });
  return freed;
}

export function resetLocalBookings() {
  local = JSON.parse(readFileSync(fixtureFile, "utf8"));
}
