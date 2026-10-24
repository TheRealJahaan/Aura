import {
  calendarDaysBetween,
  describeNow,
  isValidTimeZone,
  localDateKey,
  offsetMinutes,
  parseDateTimeInput,
  speakDay,
  speakList,
  speakRelative,
  speakTime,
  startOfDay,
  startOfDayOffset,
  zonedTimeToUtc,
} from './time';

const KOLKATA = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';

describe('time zones', () => {
  it('knows the offset of a fixed zone', () => {
    expect(offsetMinutes(new Date('2026-10-24T12:00:00Z'), KOLKATA)).toBe(330);
  });

  it('follows daylight saving time', () => {
    expect(offsetMinutes(new Date('2026-07-01T12:00:00Z'), NEW_YORK)).toBe(-240);
    expect(offsetMinutes(new Date('2026-12-01T12:00:00Z'), NEW_YORK)).toBe(-300);
  });

  it('converts a wall-clock time to the right instant', () => {
    expect(zonedTimeToUtc(2026, 10, 24, 15, 0, 0, KOLKATA).toISOString()).toBe('2026-10-24T09:30:00.000Z');
    expect(zonedTimeToUtc(2026, 3, 9, 9, 0, 0, NEW_YORK).toISOString()).toBe('2026-03-09T13:00:00.000Z');
    expect(zonedTimeToUtc(2026, 3, 7, 9, 0, 0, NEW_YORK).toISOString()).toBe('2026-03-07T14:00:00.000Z');
  });

  it('finds the start of the local day, not the UTC day', () => {
    // 01:00 in Kolkata on Oct 25 is still Oct 24 in UTC.
    const lateNight = new Date('2026-10-24T19:30:00Z');
    expect(localDateKey(lateNight, KOLKATA)).toBe('2026-10-25');
    expect(startOfDay(lateNight, KOLKATA).toISOString()).toBe('2026-10-24T18:30:00.000Z');
    expect(startOfDayOffset(lateNight, 1, KOLKATA).toISOString()).toBe('2026-10-25T18:30:00.000Z');
  });

  it('validates time zone names', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('parseDateTimeInput', () => {
  it('reads local times in the user time zone', () => {
    expect(parseDateTimeInput('2026-10-24T15:00', KOLKATA)).toEqual({
      date: new Date('2026-10-24T09:30:00Z'),
      dateOnly: false,
    });
    expect(parseDateTimeInput('2026-10-24 15:00:30', KOLKATA)?.date.toISOString()).toBe('2026-10-24T09:30:30.000Z');
  });

  it('respects an explicit offset or Z', () => {
    expect(parseDateTimeInput('2026-10-24T15:00:00Z', KOLKATA)?.date.toISOString()).toBe('2026-10-24T15:00:00.000Z');
    expect(parseDateTimeInput('2026-10-24T15:00:00-04:00', KOLKATA)?.date.toISOString()).toBe(
      '2026-10-24T19:00:00.000Z',
    );
    expect(parseDateTimeInput('2026-10-24T15:00+0530', NEW_YORK)?.date.toISOString()).toBe('2026-10-24T09:30:00.000Z');
  });

  it('marks date-only values', () => {
    expect(parseDateTimeInput('2026-10-25', KOLKATA)).toEqual({
      date: new Date('2026-10-24T18:30:00Z'),
      dateOnly: true,
    });
  });

  it('rejects impossible or vague input', () => {
    expect(parseDateTimeInput('2026-02-30', KOLKATA)).toBeNull();
    expect(parseDateTimeInput('2026-10-24T25:00', KOLKATA)).toBeNull();
    expect(parseDateTimeInput('tomorrow at 3', KOLKATA)).toBeNull();
    expect(parseDateTimeInput('', KOLKATA)).toBeNull();
  });
});

describe('speech formatting', () => {
  const now = new Date('2026-10-24T04:30:00Z'); // Saturday 10:00 AM in Kolkata

  it('speaks times naturally', () => {
    expect(speakTime(new Date('2026-10-24T09:30:00Z'), KOLKATA)).toBe('3 PM');
    expect(speakTime(new Date('2026-10-24T06:15:00Z'), KOLKATA)).toBe('11:45 AM');
    expect(speakTime(new Date('2026-10-23T18:30:00Z'), KOLKATA)).toBe('12 AM');
    expect(speakTime(new Date('2026-10-24T06:30:00Z'), KOLKATA)).toBe('12 PM');
  });

  it('speaks days relative to today', () => {
    expect(speakDay(new Date('2026-10-24T12:00:00Z'), now, KOLKATA)).toBe('today');
    expect(speakDay(new Date('2026-10-25T04:00:00Z'), now, KOLKATA)).toBe('tomorrow');
    expect(speakDay(new Date('2026-10-30T04:00:00Z'), now, KOLKATA)).toBe('on Friday');
    expect(speakDay(new Date('2026-11-03T04:00:00Z'), now, KOLKATA)).toBe('on November 3');
    expect(calendarDaysBetween(now, new Date('2026-10-23T04:00:00Z'), KOLKATA)).toBe(-1);
  });

  it('speaks durations', () => {
    expect(speakRelative(new Date(now.getTime() + 60_000), now)).toBe('in 1 minute');
    expect(speakRelative(new Date(now.getTime() + 25 * 60_000), now)).toBe('in 25 minutes');
    expect(speakRelative(new Date(now.getTime() + 120 * 60_000), now)).toBe('in 2 hours');
    expect(speakRelative(new Date(now.getTime() + 130 * 60_000), now)).toBe('in 2 hours and 10 minutes');
    expect(speakRelative(new Date(now.getTime() + 400 * 60_000), now)).toBe('in about 7 hours');
    expect(speakRelative(new Date(now.getTime() - 5 * 60_000), now)).toBe('started 5 minutes ago');
    expect(speakRelative(now, now)).toBe('now');
  });

  it('joins lists the way people say them', () => {
    expect(speakList([])).toBe('');
    expect(speakList(['Priya'])).toBe('Priya');
    expect(speakList(['Priya', 'Sam'])).toBe('Priya and Sam');
    expect(speakList(['Priya', 'Sam', 'Lee'])).toBe('Priya, Sam and Lee');
  });

  it('describes now for the AI', () => {
    expect(describeNow(now, KOLKATA)).toBe('Saturday, October 24, 2026, 10 AM');
  });
});
