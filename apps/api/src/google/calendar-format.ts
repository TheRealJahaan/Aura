import type { calendar_v3 } from '@googleapis/calendar';
import { parseDateTimeInput } from '../common/time';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
  description: string | null;
  meetLink: string | null;
  link: string | null;
  attendees: Array<{ email: string; name: string | null; self: boolean; response: string | null }>;
  declinedByMe: boolean;
}

/** Normalizes a Calendar API event. All-day dates are read in the user's time zone. */
export function toCalendarEvent(event: calendar_v3.Schema$Event, timeZone: string): CalendarEvent | null {
  const allDay = !event.start?.dateTime;
  const start = event.start?.dateTime
    ? new Date(event.start.dateTime)
    : event.start?.date
      ? parseDateTimeInput(event.start.date, timeZone)?.date
      : undefined;
  const end = event.end?.dateTime
    ? new Date(event.end.dateTime)
    : event.end?.date
      ? parseDateTimeInput(event.end.date, timeZone)?.date
      : undefined;
  if (!event.id || !start || !end) {
    return null;
  }
  const attendees = (event.attendees ?? [])
    .filter((attendee) => attendee.email && !attendee.resource)
    .map((attendee) => ({
      email: attendee.email as string,
      name: attendee.displayName ?? null,
      self: attendee.self === true,
      response: attendee.responseStatus ?? null,
    }));
  const video = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri;
  return {
    id: event.id,
    title: event.summary?.trim() || '(no title)',
    start,
    end,
    allDay,
    location: event.location ?? null,
    description: event.description ?? null,
    meetLink: event.hangoutLink ?? video ?? null,
    link: event.htmlLink ?? null,
    attendees,
    declinedByMe: attendees.some((attendee) => attendee.self && attendee.response === 'declined'),
  };
}

/** The people in a meeting other than you, by name when Google knows it. */
export function otherAttendees(event: CalendarEvent): Array<{ email: string; label: string }> {
  return event.attendees
    .filter((attendee) => !attendee.self)
    .map((attendee) => ({ email: attendee.email, label: attendee.name ?? attendee.email.split('@')[0] }));
}

export async function listEvents(
  calendar: calendar_v3.Calendar,
  options: { timeMin: Date; timeMax: Date; timeZone: string; query?: string; max?: number },
): Promise<CalendarEvent[]> {
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: options.timeMin.toISOString(),
    timeMax: options.timeMax.toISOString(),
    singleEvents: true, // expand repeating events into real occurrences
    orderBy: 'startTime',
    maxResults: options.max ?? 20,
    q: options.query,
    timeZone: options.timeZone,
  });
  return (res.data.items ?? [])
    .filter((event) => event.status !== 'cancelled')
    .map((event) => toCalendarEvent(event, options.timeZone))
    .filter((event): event is CalendarEvent => event !== null && !event.declinedByMe);
}
