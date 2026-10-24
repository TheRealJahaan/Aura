import type { GoogleApis } from '../src/google/google-apis';
import type { ToolContext, ToolOutput } from '../src/assistant/tools/tool';

// Stand-ins for Google's API clients. Each method is a jest mock that tests
// program with the responses Google would send.

export function fakeGoogle() {
  const ok = (data: unknown = {}) => jest.fn().mockResolvedValue({ data });
  return {
    gmail: {
      users: {
        messages: { list: ok({ messages: [] }), get: ok({}), send: ok({ id: 'sent-1', threadId: 'thread-1' }) },
        labels: { get: ok({ messagesUnread: 0 }) },
      },
    },
    calendar: {
      events: { list: ok({ items: [] }), insert: ok({ id: 'event-1' }), delete: ok() },
    },
    tasks: {
      tasks: {
        list: ok({ items: [] }),
        get: ok({}),
        insert: ok({ id: 'task-1' }),
        patch: ok({}),
        delete: ok(),
      },
    },
    drive: { files: { list: ok({ files: [] }) } },
    people: {
      people: { searchContacts: ok({ results: [] }) },
      otherContacts: { search: ok({ results: [] }) },
    },
  };
}

export type FakeGoogle = ReturnType<typeof fakeGoogle>;

export function fakeContext(overrides: Partial<ToolContext> = {}, google: FakeGoogle = fakeGoogle()) {
  const ctx: ToolContext = {
    userId: 'user-1',
    email: 'jahaan@example.com',
    name: 'Jahaan Suthar',
    timezone: 'Asia/Kolkata',
    // Saturday, October 24, 2026, 9:00 AM in India.
    now: new Date('2026-10-24T03:30:00.000Z'),
    google: async () => google as unknown as GoogleApis,
    undoLast: jest.fn<Promise<ToolOutput>, []>().mockResolvedValue({ data: {}, say: 'Undone.' }),
    ...overrides,
  };
  return { ctx, google };
}

/** A Gmail message as the API returns it with format=metadata. */
export function gmailMessage(id: string, from: string, subject: string, receivedAt: string, unread = true) {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: String(new Date(receivedAt).getTime()),
    labelIds: unread ? ['INBOX', 'UNREAD'] : ['INBOX'],
    snippet: 'Quick question about tomorrow&#39;s plan',
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
      ],
    },
  };
}

/** A timed Calendar event as the API returns it. */
export function calendarEvent(id: string, title: string, start: string, end: string, extra: Record<string, unknown> = {}) {
  return { id, summary: title, status: 'confirmed', start: { dateTime: start }, end: { dateTime: end }, ...extra };
}
