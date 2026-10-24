import { randomUUID } from 'node:crypto';
import type { calendar_v3 } from '@googleapis/calendar';
import { z } from 'zod';
import {
  calendarDaysBetween,
  localDateKey,
  localDateTime,
  plural,
  speakDay,
  speakList,
  speakRelative,
  speakTime,
  speakWhen,
  startOfDay,
  startOfDayOffset,
} from '../../common/time';
import { CalendarEvent, listEvents, otherAttendees } from '../../google/calendar-format';
import { dateTimeInput, emailAddress, readDateTime } from './inputs';
import { defineTool, ToolContext, ToolError } from './tool';

const MINUTE_MS = 60_000;
const MAX_RANGE_DAYS = 31;

/** An event as the AI sees it: local times, no internal fields. */
export function eventForAi(event: CalendarEvent, timeZone: string) {
  return {
    id: event.id,
    title: event.title,
    start: event.allDay ? localDateKey(event.start, timeZone) : localDateTime(event.start, timeZone),
    end: event.allDay ? localDateKey(event.end, timeZone) : localDateTime(event.end, timeZone),
    allDay: event.allDay,
    location: event.location,
    attendees: otherAttendees(event).map((attendee) => attendee.label),
    meetLink: event.meetLink,
    link: event.link,
  };
}

/** "Standup at 10 AM" (same day) or "Standup tomorrow at 10 AM". */
export function speakEvent(event: CalendarEvent, ctx: ToolContext, withDay: boolean): string {
  if (event.allDay) {
    return withDay ? `${event.title} ${speakDay(event.start, ctx.now, ctx.timezone)}, all day` : `${event.title}, all day`;
  }
  return withDay
    ? `${event.title} ${speakWhen(event.start, ctx.now, ctx.timezone)}`
    : `${event.title} at ${speakTime(event.start, ctx.timezone)}`;
}

/** Events that haven't ended yet, starting with the one happening now or next. Skips all-day events. */
export async function upcomingEvents(ctx: ToolContext, days = 7, query?: string): Promise<CalendarEvent[]> {
  const { calendar } = await ctx.google();
  const events = await listEvents(calendar, {
    timeMin: ctx.now,
    timeMax: new Date(ctx.now.getTime() + days * 86_400_000),
    timeZone: ctx.timezone,
    query,
    max: 25,
  });
  return events.filter((event) => !event.allDay && event.end > ctx.now);
}

function resolveRange(ctx: ToolContext, start?: string, end?: string): { from: Date; to: Date; restOfToday: boolean } {
  const tz = ctx.timezone;
  const from = start ? readDateTime(start, tz).date : ctx.now;
  let to: Date;
  if (end) {
    const parsed = readDateTime(end, tz);
    // A date on its own means "through the end of that day".
    to = parsed.dateOnly ? startOfDayOffset(parsed.date, 1, tz) : parsed.date;
  } else {
    to = startOfDayOffset(from, 1, tz);
  }
  if (to <= from) {
    throw new ToolError('The end of the range must be after the start.');
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    throw new ToolError(`I can look at up to ${MAX_RANGE_DAYS} days at a time.`);
  }
  return { from, to, restOfToday: !start && !end };
}

export const calendarListEvents = defineTool({
  name: 'calendar_list_events',
  description:
    "List events on the user's Google Calendar. With no dates it lists the rest of today. Dates are in the user's local time.",
  schema: z.object({
    start: dateTimeInput.optional().describe('Range start, like 2026-10-24 or 2026-10-24T09:00. Default: now'),
    end: dateTimeInput.optional().describe('Range end. A date alone means through that whole day. Default: end of the start day'),
    query: z.string().trim().max(100).optional().describe('Only events matching these words'),
  }),
  service: 'calendar',
  risk: 'read',
  summarize: () => 'check your calendar',
  async run(ctx, input) {
    const { from, to, restOfToday } = resolveRange(ctx, input.start, input.end);
    const { calendar } = await ctx.google();
    const events = (
      await listEvents(calendar, { timeMin: from, timeMax: to, timeZone: ctx.timezone, query: input.query, max: 20 })
    ).filter((event) => event.end > from);
    const lastDay = new Date(to.getTime() - 1);
    const oneDay = calendarDaysBetween(from, lastDay, ctx.timezone) === 0;
    const dayWord = speakDay(from, ctx.now, ctx.timezone);
    const data = { events: events.map((event) => eventForAi(event, ctx.timezone)) };

    if (events.length === 0) {
      const say = restOfToday
        ? 'Nothing else on your calendar today.'
        : oneDay
          ? `Your calendar is clear ${dayWord}.`
          : 'Your calendar is clear for that time.';
      return { data, say };
    }
    const spoken = events.slice(0, 5).map((event) => speakEvent(event, ctx, !oneDay));
    const more = events.length > 5 ? `, plus ${plural(events.length - 5, 'more event')}` : '';
    const count = plural(events.length, restOfToday ? 'more event' : 'event', restOfToday ? 'more events' : 'events');
    const when = restOfToday ? 'today' : oneDay ? dayWord : 'in that time';
    return { data, say: `You have ${count} ${when}: ${speakList(spoken)}${more}.` };
  },
});

export const calendarNextEvent = defineTool({
  name: 'calendar_next_event',
  description: "Find the user's current or next calendar event in the coming week.",
  schema: z.object({}),
  service: 'calendar',
  risk: 'read',
  endsTurn: true,
  summarize: () => 'find your next event',
  async run(ctx) {
    const events = await upcomingEvents(ctx);
    const [first, second] = events;
    if (!first) {
      return { data: { event: null }, say: 'Nothing on your calendar for the next 7 days.' };
    }
    const data = { event: eventForAi(first, ctx.timezone) };
    if (first.start <= ctx.now) {
      const after = second ? ` After that, ${speakEvent(second, ctx, true)}.` : '';
      return { data, say: `You're in ${first.title} right now. It ends at ${speakTime(first.end, ctx.timezone)}.${after}` };
    }
    return {
      data,
      say: `Next up is ${speakEvent(first, ctx, true)}, ${speakRelative(first.start, ctx.now)}.`,
    };
  },
});

export const calendarCreateEvent = defineTool({
  name: 'calendar_create_event',
  description:
    "Add an event to the user's Google Calendar. Times are the user's local time. If attendees are given, Google emails them an invitation, so the user is asked to confirm first.",
  schema: z.object({
    title: z.string().trim().min(1).max(200),
    start: dateTimeInput.describe('Start, like 2026-10-24T15:00, or a date alone for an all-day event'),
    end: dateTimeInput.optional().describe('End time. Leave out to use durationMinutes'),
    durationMinutes: z.number().int().min(5).max(1440).default(30),
    attendees: z.array(emailAddress).max(20).default([]).describe('Guest email addresses to invite'),
    location: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    addMeetLink: z.boolean().default(false).describe('Add a Google Meet video link'),
  }),
  service: 'calendar',
  risk: 'write',
  endsTurn: true,
  needsConfirmation: (input) => input.attendees.length > 0,
  validate(input, ctx) {
    const { start, end } = eventTimes(input, ctx.timezone);
    if (end.date <= start.date) {
      throw new ToolError('The event must end after it starts.');
    }
    if (!start.dateOnly && start.date.getTime() < ctx.now.getTime() - 5 * MINUTE_MS) {
      throw new ToolError('That time has already passed. Pick a time in the future.');
    }
    if (start.dateOnly && start.date < startOfDay(ctx.now, ctx.timezone)) {
      throw new ToolError('That day has already passed. Pick a day in the future.');
    }
  },
  summarize(input, ctx) {
    const { start } = eventTimes(input, ctx.timezone);
    const when = start.dateOnly
      ? `${speakDay(start.date, ctx.now, ctx.timezone)}, all day`
      : speakWhen(start.date, ctx.now, ctx.timezone);
    const guests = input.attendees.length > 0 ? ` and invite ${speakList(input.attendees)}` : '';
    return `add "${input.title}" to your calendar ${when}${guests}`;
  },
  details(input, ctx) {
    const { start, end } = eventTimes(input, ctx.timezone);
    const rows = [
      { label: 'Event', value: input.title },
      {
        label: 'When',
        value: start.dateOnly
          ? `${localDateKey(start.date, ctx.timezone)} (all day)`
          : `${localDateTime(start.date, ctx.timezone).replace('T', ' ')} to ${speakTime(end.date, ctx.timezone)}`,
      },
    ];
    if (input.attendees.length > 0) rows.push({ label: 'Invite', value: input.attendees.join(', ') });
    if (input.addMeetLink) rows.push({ label: 'Video', value: 'Google Meet link' });
    if (input.location) rows.push({ label: 'Where', value: input.location });
    return rows;
  },
  async run(ctx, input) {
    const { calendar } = await ctx.google();
    const { start, end } = eventTimes(input, ctx.timezone);
    const tz = ctx.timezone;
    const requestBody: calendar_v3.Schema$Event = {
      summary: input.title,
      location: input.location,
      description: input.description,
      start: start.dateOnly ? { date: localDateKey(start.date, tz) } : { dateTime: start.date.toISOString(), timeZone: tz },
      end: start.dateOnly ? { date: localDateKey(end.date, tz) } : { dateTime: end.date.toISOString(), timeZone: tz },
      attendees: input.attendees.map((email) => ({ email })),
    };
    if (input.addMeetLink) {
      requestBody.conferenceData = {
        createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
      };
    }
    const { data } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody,
      conferenceDataVersion: input.addMeetLink ? 1 : 0,
      sendUpdates: input.attendees.length > 0 ? 'all' : 'none',
    });
    const when = start.dateOnly ? `${speakDay(start.date, ctx.now, tz)}, all day` : speakWhen(start.date, ctx.now, tz);
    const extras = [
      input.addMeetLink && data.hangoutLink ? 'with a Google Meet link' : null,
      input.attendees.length > 0 ? `and I invited ${speakList(input.attendees)}` : null,
    ].filter(Boolean);
    return {
      data: { created: true, id: data.id, link: data.htmlLink ?? null, meetLink: data.hangoutLink ?? null },
      say: `Done. ${input.title} is on your calendar ${when}${extras.length ? `, ${extras.join(', ')}` : ''}.`,
      undo: { eventId: data.id, title: input.title, notify: input.attendees.length > 0 },
    };
  },
  async undo(ctx, data) {
    const { calendar } = await ctx.google();
    const notify = data.notify === true;
    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: String(data.eventId),
        sendUpdates: notify ? 'all' : 'none',
      });
    } catch (err) {
      if (isGone(err)) return `${String(data.title)} was already deleted.`;
      throw err;
    }
    return `I removed ${String(data.title)} from your calendar${notify ? ' and let the guests know' : ''}.`;
  },
});

/** Start and end of a new event. An all-day event's end is the day after it (Google's rule). */
function eventTimes(
  input: { start: string; end?: string; durationMinutes: number },
  timeZone: string,
): { start: { date: Date; dateOnly: boolean }; end: { date: Date } } {
  const start = readDateTime(input.start, timeZone);
  if (start.dateOnly) {
    const lastDay = input.end ? readDateTime(input.end, timeZone).date : start.date;
    return { start, end: { date: startOfDayOffset(lastDay, 1, timeZone) } };
  }
  const end = input.end
    ? readDateTime(input.end, timeZone).date
    : new Date(start.date.getTime() + input.durationMinutes * MINUTE_MS);
  return { start, end: { date: end } };
}

export function isGone(err: unknown): boolean {
  const status = (err as { response?: { status?: number }; status?: number })?.response?.status ?? (err as { status?: number })?.status;
  return status === 404 || status === 410;
}

export const calendarTools = [calendarListEvents, calendarNextEvent, calendarCreateEvent];
