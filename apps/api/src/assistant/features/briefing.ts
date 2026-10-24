import { z } from 'zod';
import { greeting, plural, speakDate, speakList, speakRelative, speakTime, startOfDay, startOfDayOffset } from '../../common/time';
import { listEvents } from '../../google/calendar-format';
import { describeGoogleError } from '../../google/google-errors';
import { eventForAi, speakEvent } from '../tools/calendar.tools';
import { fetchEmailSummaries, forAi, speakEmail } from '../tools/gmail.tools';
import { daysUntilDue, listOpenTasks } from '../tools/tasks.tools';
import { defineTool, ToolContext, ToolOutput } from '../tools/tool';

// "Brief me": one spoken answer that pulls today's calendar, inbox and tasks
// together. It never needs the AI, so it is fast and always worded the same.

async function calendarSection(ctx: ToolContext) {
  const { calendar } = await ctx.google();
  const events = await listEvents(calendar, {
    timeMin: startOfDay(ctx.now, ctx.timezone),
    timeMax: startOfDayOffset(ctx.now, 1, ctx.timezone),
    timeZone: ctx.timezone,
    max: 25,
  });
  const allDay = events.filter((event) => event.allDay);
  const left = events.filter((event) => !event.allDay && event.end > ctx.now);
  const sentences: string[] = [];
  if (left.length === 0) {
    sentences.push('Your calendar is clear for the rest of the day.');
  } else {
    const [first, ...rest] = left;
    const opening =
      first.start <= ctx.now
        ? `You're in ${first.title} until ${speakTime(first.end, ctx.timezone)}`
        : `First up is ${speakEvent(first, ctx, false)}, ${speakRelative(first.start, ctx.now)}`;
    const then = rest.length > 0 ? `, then ${speakList(rest.slice(0, 3).map((event) => speakEvent(event, ctx, false)))}` : '';
    const more = rest.length > 3 ? `, and ${rest.length - 3} more` : '';
    sentences.push(`You have ${plural(left.length, 'event')} left today. ${opening}${then}${more}.`);
  }
  if (allDay.length > 0) {
    sentences.push(`All day: ${speakList(allDay.slice(0, 2).map((event) => event.title))}.`);
  }
  return { say: sentences.join(' '), data: { eventsLeft: left.map((event) => eventForAi(event, ctx.timezone)) } };
}

async function inboxSection(ctx: ToolContext) {
  const { gmail } = await ctx.google();
  const [label, important] = await Promise.all([
    gmail.users.labels.get({ userId: 'me', id: 'INBOX' }),
    fetchEmailSummaries(gmail, ctx, 'is:unread in:inbox category:primary newer_than:2d', 3),
  ]);
  const unread = label.data.messagesUnread ?? 0;
  let say: string;
  if (unread === 0) {
    say = 'Your inbox has no unread email.';
  } else if (important.length === 0) {
    say = `You have ${plural(unread, 'unread email')}, but nothing new in Primary since yesterday.`;
  } else {
    say = `You have ${plural(unread, 'unread email')}. The latest are from ${speakList(important.map(speakEmail))}.`;
  }
  return { say, data: { unread, latest: important.map(forAi) } };
}

async function tasksSection(ctx: ToolContext) {
  const open = await listOpenTasks(ctx);
  const dueToday = open.filter((task) => daysUntilDue(task, ctx) === 0);
  const overdue = open.filter((task) => (daysUntilDue(task, ctx) ?? 0) < 0);
  const sentences: string[] = [];
  if (dueToday.length > 0) {
    sentences.push(`Due today: ${speakList(dueToday.slice(0, 3).map((task) => task.title))}.`);
  }
  if (overdue.length > 0) {
    sentences.push(`Overdue: ${speakList(overdue.slice(0, 3).map((task) => task.title))}.`);
  }
  if (sentences.length === 0) {
    sentences.push(open.length > 0 ? `Nothing is due today on your ${plural(open.length, 'open task')}.` : 'No tasks due.');
  }
  return { say: sentences.join(' '), data: { dueToday, overdue } };
}

export async function buildBriefing(ctx: ToolContext): Promise<ToolOutput> {
  const sections = [
    { key: 'calendar', service: 'calendar', build: calendarSection },
    { key: 'inbox', service: 'gmail', build: inboxSection },
    { key: 'tasks', service: 'tasks', build: tasksSection },
  ] as const;
  const results = await Promise.allSettled(sections.map((section) => section.build(ctx)));

  const firstName = ctx.name?.split(/\s+/)[0];
  const parts = [`${greeting(ctx.now, ctx.timezone)}${firstName ? `, ${firstName}` : ''}. It's ${speakDate(ctx.now, ctx.timezone)}.`];
  const problems = new Set<string>();
  const data: Record<string, unknown> = {};
  results.forEach((result, index) => {
    const section = sections[index];
    if (result.status === 'fulfilled') {
      parts.push(result.value.say);
      data[section.key] = result.value.data;
    } else {
      const problem = describeGoogleError(result.reason, section.service);
      problems.add(problem);
      data[section.key] = { error: problem };
    }
  });
  parts.push(...problems);
  return { data, say: parts.join(' '), services: ['calendar', 'gmail', 'tasks'] };
}

export const dailyBriefing = defineTool({
  name: 'daily_briefing',
  description: "Give the user a spoken summary of their day: what's left on the calendar, unread email and tasks due.",
  schema: z.object({}),
  service: null,
  risk: 'read',
  endsTurn: true,
  summarize: () => 'brief you on your day',
  run: (ctx) => buildBriefing(ctx),
});
