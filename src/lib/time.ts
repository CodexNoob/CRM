/** Firm-local time helpers. Appointments are entered in the firm's time zone and stored in UTC. */

export const FIRM_TZ = () => process.env.FIRM_TIMEZONE || "America/New_York";

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instant.getTime();
}

/** "2027-03-01T09:30" in `timeZone` → the UTC instant. Handles DST transitions. */
export function zonedLocalToUtc(local: string, timeZone = FIRM_TZ()): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error("Invalid local date-time");
  const naive = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let guess = naive - tzOffsetMs(new Date(naive), timeZone);
  guess = naive - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** UTC instant → "YYYY-MM-DD" in `timeZone`. */
export function localDate(instant: Date, timeZone = FIRM_TZ()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

export function formatTime(instant: Date, timeZone = FIRM_TZ()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(instant);
}

export function formatDateTime(instant: Date, timeZone = FIRM_TZ()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(instant);
}
