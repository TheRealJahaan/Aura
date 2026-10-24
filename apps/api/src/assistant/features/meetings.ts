import { z } from 'zod';
import { speakDay, speakList, speakRelative, speakTime, speakWhen } from '../../common/time';
import { CalendarEvent, otherAttendees } from '../../google/calendar-format';
import { describeGoogleError } from '../../google/google-errors';
import { htmlToText, truncate } from '../../google/gmail-format';
import { withAccount } from '../../google/links';
import { eventForAi, upcomingEvents } from '../tools/calendar.tools';
import { driveFileForAi, escapeDriveValue, searchDrive } from '../tools/drive.tools';
import { fetchEmailSummaries, forAi, speakEmail } from '../tools/gmail.tools';
import { defineTool, ToolContext } from '../tools/tool';

const JOIN_WINDOW_MS = 60 * 60_000;

const STOPWORDS = new Set([
  'with', 'about', 'meeting', 'call', 'sync', 'weekly', 'daily', 'monthly', 'review', 'chat', 'catch', 'catchup',
  'the', 'and', 'for', 'from', 'this', 'that', 'team', 'quick', 'intro', 'session', 'discussion', 'update',
]);

/** The words in a meeting title most likely to appear in related file names. */
export function titleKeywords(title: string): string[] {
  return [...new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u))]
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
}

/** "Priya, Sam and 3 others". */
function speakPeople(labels: string[]): string {
  if (labels.length <= 3) return speakList(labels);
  return `${labels.slice(0, 2).join(', ')} and ${labels.length - 2} others`;
}

function cleanAgenda(description: string | null): string | null {
  if (!description) return null;
  const text = htmlToText(description).replace(/\s+/g, ' ').trim();
  return text ? truncate(text, 300) : null;
}

async function prepFor(ctx: ToolContext, event: CalendarEvent) {
  const people = otherAttendees(event).slice(0, 8);
  const keywords = titleKeywords(event.title);
  const { gmail, drive } = await ctx.google();

  const emailQuery = people.length
    ? `(${people
        .slice(0, 5)
        .map(({ email }) => email.replace(/"/g, ''))
        .map((email) => `from:"${email}" OR to:"${email}"`)
        .join(' OR ')}) newer_than:30d`
    : null;
  const fileQuery = keywords.length
    ? `(${keywords.map((word) => `name contains '${escapeDriveValue(word)}'`).join(' or ')}) and trashed = false`
    : null;

  const [emails, files] = await Promise.allSettled([
    emailQuery ? fetchEmailSummaries(gmail, ctx, emailQuery, 3) : Promise.resolve([]),
    fileQuery ? searchDrive(drive, ctx, fileQuery, 3) : Promise.resolve([]),
  ]);
  return { people, emails, files, agenda: cleanAgenda(event.description) };
}

export const meetingPrep = defineTool({
  name: 'meeting_prep',
  description:
    'Prepare the user for their next meeting (or the next one matching a few words): who is coming, the agenda, recent emails with them and related Drive files.',
  schema: z.object({
    query: z.string().trim().max(100).optional().describe('Words from the meeting title, if the user named one'),
  }),
  service: null,
  risk: 'read',
  endsTurn: true,
  summarize: () => 'prepare you for your meeting',
  async run(ctx, input) {
    const events = await upcomingEvents(ctx, 7, input.query);
    const event = events[0];
    if (!event) {
      return {
        data: { meeting: null },
        say: input.query
          ? `I couldn't find a meeting matching "${input.query}" in the next 7 days.`
          : "You don't have any meetings in the next 7 days.",
        services: ['calendar'],
      };
    }
    const prep = await prepFor(ctx, event);
    const sentences: string[] = [
      event.start <= ctx.now
        ? `You're in ${event.title} right now, until ${speakTime(event.end, ctx.timezone)}.`
        : `Your next meeting is ${event.title}, ${speakWhen(event.start, ctx.now, ctx.timezone)}, ${speakRelative(event.start, ctx.now)}.`,
    ];
    sentences.push(prep.people.length ? `It's with ${speakPeople(prep.people.map((p) => p.label))}.` : "It's just you on the invite.");
    if (prep.agenda) sentences.push(`The invite says: ${prep.agenda}`);

    const problems = new Set<string>();
    if (prep.emails.status === 'fulfilled' && prep.emails.value.length > 0) {
      const latest = prep.emails.value[0];
      sentences.push(`Your latest email with them is from ${speakEmail(latest)}, ${speakDay(latest.receivedAt, ctx.now, ctx.timezone)}.`);
    } else if (prep.emails.status === 'rejected') {
      problems.add(describeGoogleError(prep.emails.reason, 'gmail'));
    }
    if (prep.files.status === 'fulfilled' && prep.files.value.length > 0) {
      sentences.push(`Related files: ${speakList(prep.files.value.map((file) => file.name))}.`);
    } else if (prep.files.status === 'rejected') {
      problems.add(describeGoogleError(prep.files.reason, 'drive'));
    }
    if (event.meetLink) sentences.push('It has a Meet link. Say "join my meeting" when it\'s time.');
    sentences.push(...problems);

    return {
      data: {
        meeting: eventForAi(event, ctx.timezone),
        untrustedAgenda: prep.agenda,
        recentEmails: prep.emails.status === 'fulfilled' ? prep.emails.value.map(forAi) : [],
        relatedFiles: prep.files.status === 'fulfilled' ? prep.files.value.map(driveFileForAi) : [],
      },
      say: sentences.join(' '),
      services: ['calendar', 'gmail', 'drive'],
    };
  },
});

export const meetingJoin = defineTool({
  name: 'meeting_join',
  description: "Open the Google Meet link of the meeting happening now or starting within the hour.",
  schema: z.object({}),
  service: 'meet',
  risk: 'read',
  endsTurn: true,
  summarize: () => 'join your meeting',
  async run(ctx) {
    const withVideo = (await upcomingEvents(ctx, 1)).filter((event) => event.meetLink);
    const next = withVideo[0];
    if (!next) {
      return { data: { meeting: null }, say: "You don't have any video meetings in the next day." };
    }
    if (next.start.getTime() - ctx.now.getTime() > JOIN_WINDOW_MS) {
      return {
        data: { meeting: eventForAi(next, ctx.timezone), opened: false },
        say: `Your next video meeting is ${next.title}, ${speakWhen(next.start, ctx.now, ctx.timezone)}. Ask me again closer to the time.`,
      };
    }
    const url = withAccount(next.meetLink as string, ctx.email);
    return {
      data: { meeting: eventForAi(next, ctx.timezone), opened: true },
      say: next.start <= ctx.now ? `Joining ${next.title}. It started at ${speakTime(next.start, ctx.timezone)}.` : `Opening ${next.title}. It starts ${speakRelative(next.start, ctx.now)}.`,
      actions: [{ type: 'open_url', url, label: next.title }],
    };
  },
});

export const meetingTools = [meetingPrep, meetingJoin];
