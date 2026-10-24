import { calendarEvent, fakeContext, fakeGoogle, gmailMessage } from '../../../test/fakes';
import { buildBriefing } from './briefing';
import { meetingJoin, meetingPrep, titleKeywords } from './meetings';

describe('daily briefing', () => {
  function googleWithDay() {
    const google = fakeGoogle();
    google.calendar.events.list.mockResolvedValue({
      data: {
        items: [
          calendarEvent('e0', 'Gym', '2026-10-24T07:00:00+05:30', '2026-10-24T08:00:00+05:30'),
          calendarEvent('e1', 'Standup', '2026-10-24T09:25:00+05:30', '2026-10-24T09:40:00+05:30'),
          calendarEvent('e2', 'Lunch with Sam', '2026-10-24T13:00:00+05:30', '2026-10-24T14:00:00+05:30'),
          { id: 'e3', summary: 'Diwali', status: 'confirmed', start: { date: '2026-10-24' }, end: { date: '2026-10-25' } },
        ],
      },
    });
    google.gmail.users.labels.get.mockResolvedValue({ data: { messagesUnread: 12 } });
    google.gmail.users.messages.list.mockResolvedValue({ data: { messages: [{ id: 'm1' }, { id: 'm2' }] } });
    google.gmail.users.messages.get
      .mockResolvedValueOnce({ data: gmailMessage('m1', 'Priya Sharma <priya@example.com>', 'Q3 numbers', '2026-10-24T02:00:00Z') })
      .mockResolvedValueOnce({ data: gmailMessage('m2', 'Sam <sam@example.com>', 'Lunch', '2026-10-24T01:00:00Z') });
    google.tasks.tasks.list.mockResolvedValue({
      data: {
        items: [
          { id: 't1', title: 'Pay rent', due: '2026-10-22T00:00:00.000Z' },
          { id: 't2', title: 'Call mom', due: '2026-10-24T00:00:00.000Z' },
        ],
      },
    });
    return google;
  }

  it('speaks the whole day in one answer', async () => {
    const { ctx } = fakeContext({}, googleWithDay());
    const out = await buildBriefing(ctx);
    expect(out.say).toBe(
      [
        "Good morning, Jahaan. It's Saturday, October 24.",
        'You have 2 events left today. First up is Standup at 9:25 AM, in 25 minutes, then Lunch with Sam at 1 PM.',
        'All day: Diwali.',
        'You have 12 unread emails. The latest are from Priya Sharma about Q3 numbers and Sam about Lunch.',
        'Due today: Call mom. Overdue: Pay rent.',
      ].join(' '),
    );
    expect(out.services).toEqual(['calendar', 'gmail', 'tasks']);
  });

  it('still briefs when one service fails', async () => {
    const google = googleWithDay();
    google.gmail.users.labels.get.mockRejectedValue(
      Object.assign(new Error('Gmail API has not been used in project 123'), { response: { status: 403 } }),
    );
    const out = await buildBriefing(fakeContext({}, google).ctx);
    expect(out.say).toContain('First up is Standup');
    expect(out.say).toContain('Due today: Call mom.');
    expect(out.say).toContain('The Gmail API is turned off in your Google Cloud project.');
    expect(out.data).toMatchObject({ inbox: { error: expect.stringContaining('Gmail API') } });
  });

  it('handles an empty day', async () => {
    const { ctx } = fakeContext({ name: null });
    const out = await buildBriefing(ctx);
    expect(out.say).toBe(
      "Good morning. It's Saturday, October 24. Your calendar is clear for the rest of the day. Your inbox has no unread email. No tasks due.",
    );
  });
});

describe('meeting prep', () => {
  it('picks keywords from the meeting title', () => {
    expect(titleKeywords('Weekly sync: Q3 Roadmap review with Priya')).toEqual(['roadmap', 'priya']);
    expect(titleKeywords('Call')).toEqual([]);
  });

  it('brings attendees, agenda, emails and files together', async () => {
    const google = fakeGoogle();
    google.calendar.events.list.mockResolvedValue({
      data: {
        items: [
          calendarEvent('e1', 'Roadmap review', '2026-10-24T11:00:00+05:30', '2026-10-24T12:00:00+05:30', {
            description: '<b>Agenda:</b> Q3 goals<br>Hiring plan',
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
            attendees: [
              { email: 'jahaan@example.com', self: true, responseStatus: 'accepted' },
              { email: 'priya@example.com', displayName: 'Priya Sharma' },
              { email: 'sam@example.com' },
              { email: 'room-1@resource.calendar.google.com', resource: true },
            ],
          }),
        ],
      },
    });
    google.gmail.users.messages.list.mockResolvedValue({ data: { messages: [{ id: 'm1' }] } });
    google.gmail.users.messages.get.mockResolvedValue({
      data: gmailMessage('m1', 'Priya Sharma <priya@example.com>', 'Roadmap draft', '2026-10-23T09:00:00Z'),
    });
    google.drive.files.list.mockResolvedValue({
      data: { files: [{ id: 'f1', name: 'Roadmap 2027', mimeType: 'application/vnd.google-apps.presentation' }] },
    });

    const { ctx } = fakeContext({}, google);
    const out = await meetingPrep.run(ctx, meetingPrep.schema.parse({}));

    expect(google.gmail.users.messages.list.mock.calls[0][0].q).toBe(
      '(from:"priya@example.com" OR to:"priya@example.com" OR from:"sam@example.com" OR to:"sam@example.com") newer_than:30d',
    );
    expect(google.drive.files.list.mock.calls[0][0].q).toBe("(name contains 'roadmap') and trashed = false");
    expect(out.say).toBe(
      [
        'Your next meeting is Roadmap review, today at 11 AM, in 2 hours.',
        "It's with Priya Sharma and sam.",
        'The invite says: Agenda: Q3 goals Hiring plan',
        'Your latest email with them is from Priya Sharma about Roadmap draft, yesterday.',
        'Related files: Roadmap 2027.',
        'It has a Meet link. Say "join my meeting" when it\'s time.',
      ].join(' '),
    );
    expect(out.data).toMatchObject({ untrustedAgenda: 'Agenda: Q3 goals Hiring plan' });
  });

  it('says when there is nothing to prepare for', async () => {
    const { ctx } = fakeContext();
    const out = await meetingPrep.run(ctx, meetingPrep.schema.parse({ query: 'board meeting' }));
    expect(out.say).toBe('I couldn\'t find a meeting matching "board meeting" in the next 7 days.');
  });
});

describe('join meeting', () => {
  it('opens a meeting that starts soon', async () => {
    const google = fakeGoogle();
    google.calendar.events.list.mockResolvedValue({
      data: {
        items: [
          calendarEvent('e1', 'No video', '2026-10-24T09:10:00+05:30', '2026-10-24T09:20:00+05:30'),
          calendarEvent('e2', 'Standup', '2026-10-24T09:20:00+05:30', '2026-10-24T09:35:00+05:30', {
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
          }),
        ],
      },
    });
    const out = await meetingJoin.run(fakeContext({}, google).ctx, {});
    expect(out.actions).toEqual([
      { type: 'open_url', url: 'https://meet.google.com/abc-defg-hij?authuser=jahaan%40example.com', label: 'Standup' },
    ]);
    expect(out.say).toBe('Opening Standup. It starts in 20 minutes.');
  });

  it('waits when the meeting is hours away', async () => {
    const google = fakeGoogle();
    google.calendar.events.list.mockResolvedValue({
      data: {
        items: [
          calendarEvent('e2', 'Review', '2026-10-24T16:00:00+05:30', '2026-10-24T17:00:00+05:30', {
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
          }),
        ],
      },
    });
    const out = await meetingJoin.run(fakeContext({}, google).ctx, {});
    expect(out.actions).toBeUndefined();
    expect(out.say).toBe('Your next video meeting is Review, today at 4 PM. Ask me again closer to the time.');
  });
});
