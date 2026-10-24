// Dates are the easiest thing for an assistant to get wrong, so all date math
// lives here, works in the user's own time zone, and is unit-tested.

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const values: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(date)) {
    values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday),
  };
}

/** How far ahead of UTC `timeZone` is at `date`, in minutes (Asia/Kolkata = 330). */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wallAsUtc - Math.floor(date.getTime() / 1000) * 1000) / MINUTE_MS);
}

/** The instant when the clock in `timeZone` shows the given wall-clock time. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes, because the offset can change (daylight saving) between the guess and the answer.
  const first = wall - offsetMinutes(new Date(wall), timeZone) * MINUTE_MS;
  return new Date(wall - offsetMinutes(new Date(first), timeZone) * MINUTE_MS);
}

export function startOfDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

/** Start of the day `days` days after the day containing `date`. */
export function startOfDayOffset(date: Date, days: number, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day + days, 0, 0, 0, timeZone);
}

/** "2026-10-24" for the day containing `date` in `timeZone`. */
export function localDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "2026-10-24T19:42" in `timeZone`. */
export function localDateTime(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${localDateKey(date, timeZone)}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

export interface ParsedDateTime {
  date: Date;
  /** True when only a date was given, like "2026-10-24". */
  dateOnly: boolean;
}

/**
 * Reads a date or date-time from the AI. Times without an offset
 * ("2026-10-24T15:00") are in the user's time zone; times with one
 * ("...+05:30" or "...Z") are taken as given. Returns null for anything else,
 * including impossible dates like February 30.
 */
export function parseDateTimeInput(text: string, timeZone: string): ParsedDateTime | null {
  const match = DATE_TIME_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, y, mo, d, h, mi, s, zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = h === undefined ? 0 : Number(h);
  const minute = mi === undefined ? 0 : Number(mi);
  const second = s === undefined ? 0 : Number(s);

  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute ||
    probe.getUTCSeconds() !== second
  ) {
    return null;
  }

  if (zone && h !== undefined) {
    const offset =
      zone.toUpperCase() === 'Z'
        ? 0
        : (zone.startsWith('-') ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    return { date: new Date(probe.getTime() - offset * MINUTE_MS), dateOnly: false };
  }
  return {
    date: zonedTimeToUtc(year, month, day, hour, minute, second, timeZone),
    dateOnly: h === undefined,
  };
}

function dayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** Whole days from `from` to `to`, counted on the calendar in `timeZone`. */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  return dayNumber(localDateKey(to, timeZone)) - dayNumber(localDateKey(from, timeZone));
}

/** "3 PM" or "11:30 AM". */
export function speakTime(date: Date, timeZone: string): string {
  const { hour, minute } = zonedParts(date, timeZone);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 || 12;
  return minute === 0 ? `${h12} ${suffix}` : `${h12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** "today", "tomorrow", "on Friday" or "on November 3". */
export function speakDay(date: Date, now: Date, timeZone: string): string {
  const days = calendarDaysBetween(now, date, timeZone);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const p = zonedParts(date, timeZone);
  if (days > 1 && days < 7) return `on ${WEEKDAYS[p.weekday]}`;
  return `on ${MONTHS[p.month - 1]} ${p.day}`;
}

/** "today at 3 PM", "on Friday at 9:30 AM". */
export function speakWhen(date: Date, now: Date, timeZone: string): string {
  return `${speakDay(date, now, timeZone)} at ${speakTime(date, timeZone)}`;
}

/** "in 25 minutes", "in 2 hours and 10 minutes", "now", "started 5 minutes ago". */
export function speakRelative(target: Date, now: Date): string {
  const minutes = Math.round((target.getTime() - now.getTime()) / MINUTE_MS);
  if (minutes === 0) return 'now';
  if (minutes < 0) {
    const ago = -minutes;
    return ago < 60 ? `started ${plural(ago, 'minute')} ago` : `started ${plural(Math.round(ago / 60), 'hour')} ago`;
  }
  if (minutes < 60) return `in ${plural(minutes, 'minute')}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `in ${plural(hours, 'hour')}`;
  if (hours < 3) return `in ${plural(hours, 'hour')} and ${plural(rest, 'minute')}`;
  return `in about ${plural(Math.round(minutes / 60), 'hour')}`;
}

export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

/** "A", "A and B", "A, B and C". */
export function speakList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "Saturday, October 24". */
export function speakDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${WEEKDAYS[p.weekday]}, ${MONTHS[p.month - 1]} ${p.day}`;
}

/** "Saturday, October 24, 2026, 7:42 PM": the "now" line the AI sees each turn. */
export function describeNow(now: Date, timeZone: string): string {
  const p = zonedParts(now, timeZone);
  return `${WEEKDAYS[p.weekday]}, ${MONTHS[p.month - 1]} ${p.day}, ${p.year}, ${speakTime(now, timeZone)}`;
}

export function greeting(now: Date, timeZone: string): string {
  const { hour } = zonedParts(now, timeZone);
  if (hour < 5) return 'Hi';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
