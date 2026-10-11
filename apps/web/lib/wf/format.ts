// Display strings in the company's timezone (v6 shows "9:04", "Mon 9:02", "1 h 12 m", "4 days").
// Shared by the server (snapshot) and the client (live updates).

export const TZ_DEFAULT = "America/New_York";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts })));
  return f;
}

/** "9:04" (12-hour, no suffix, as in the v6 mockups). */
export function clock(iso: string, tz = TZ_DEFAULT) {
  return fmt(tz, { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(/\s?[AP]M$/, "");
}

/** "Sat 9:20" within a week of `now`, else "May 4". */
export function dayClock(iso: string, now = Date.now(), tz = TZ_DEFAULT) {
  const t = new Date(iso).getTime();
  if (Math.abs(now - t) < 6.5 * 86400e3) return `${fmt(tz, { weekday: "short" }).format(t)} ${clock(iso, tz)}`;
  return fmt(tz, { month: "short", day: "numeric" }).format(t);
}

/** "38 m", "1 h 12 m", "4.2 days". */
export function duration(ms: number) {
  const m = Math.max(0, Math.round(ms / 60e3));
  if (m < 1) return "<1 m";
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
  const d = Math.round((ms / 86400e3) * 10) / 10;
  return `${d} days`;
}

/** "data_access" → "Data access". */
export const taskLabel = (t: string) => (t.charAt(0).toUpperCase() + t.slice(1)).replace(/_/g, " ");
export const firstName = (name: string) => name.split(" ")[0];
