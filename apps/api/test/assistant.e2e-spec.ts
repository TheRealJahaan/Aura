import request from 'supertest';
import { LlmError } from '../src/assistant/llm/types';
import { SessionsService } from '../src/auth/sessions.service';
import { createTestApp, deleteUser, TestApp } from './test-app';

describe('Assistant (e2e)', () => {
  let t: TestApp;
  let auth: { Authorization: string };
  let otherAuth: { Authorization: string };
  const email = 'assistant-e2e@example.com';
  const otherEmail = 'someone-else@example.com';

  beforeAll(async () => {
    t = await createTestApp();
    await deleteUser(t.prisma, email);
    await deleteUser(t.prisma, otherEmail);
    const sessions = t.app.get(SessionsService);
    const user = await t.prisma.user.create({ data: { email, name: 'Jahaan Suthar', timezone: 'Asia/Kolkata' } });
    const other = await t.prisma.user.create({ data: { email: otherEmail } });
    auth = { Authorization: `Bearer ${await sessions.create(user.id)}` };
    otherAuth = { Authorization: `Bearer ${await sessions.create(other.id)}` };
  });

  beforeEach(() => {
    t.llm.replies = [];
    t.llm.requests = [];
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await deleteUser(t.prisma, email);
    await deleteUser(t.prisma, otherEmail);
    await t.app.close();
  });

  const http = () => request(t.app.getHttpServer());
  const say = (text: string, conversationId?: string) =>
    http().post('/assistant/turn').set(auth).send({ text, conversationId }).expect(200);

  it('needs a signed-in user', async () => {
    await http().post('/assistant/turn').send({ text: 'open mail' }).expect(401);
    await http().get('/assistant/actions').expect(401);
  });

  it('rejects empty input', async () => {
    await http().post('/assistant/turn').set(auth).send({ text: '   ' }).expect(400);
  });

  it('opens Gmail instantly without the AI', async () => {
    const res = await say('Open mail.');
    expect(res.body).toMatchObject({
      reply: 'Opening Gmail.',
      actions: [{ type: 'open_url', url: 'https://mail.google.com/mail/u/?authuser=assistant-e2e%40example.com', label: 'Gmail' }],
      pendingConfirmation: null,
      services: ['gmail'],
    });
    expect(t.llm.requests).toHaveLength(0);
  });

  it('looks up a contact, asks before sending, and sends on "yes"', async () => {
    t.google.people.people.searchContacts.mockImplementation(async ({ query }: { query: string }) => ({
      data: query ? { results: [{ person: { names: [{ displayName: 'Priya Sharma' }], emailAddresses: [{ value: 'priya@example.com' }] } }] } : {},
    }));
    t.llm.replies = [
      { text: '', toolCalls: [{ id: 'call-1', name: 'contacts_search', input: { query: 'Priya' } }] },
      {
        text: "I'll send that now.",
        toolCalls: [
          { id: 'call-2', name: 'gmail_send', input: { to: ['priya@example.com'], subject: 'Lunch', body: 'Lunch at 1 tomorrow?\nJahaan' } },
        ],
      },
    ];

    const first = await say('Email Priya and ask if she wants lunch tomorrow at 1');
    expect(first.body.reply).toBe('I\'m about to send an email to priya@example.com with the subject "Lunch". Should I go ahead?');
    expect(first.body.pendingConfirmation).toMatchObject({
      summary: 'Send an email to priya@example.com with the subject "Lunch"',
      details: [
        { label: 'To', value: 'priya@example.com' },
        { label: 'Subject', value: 'Lunch' },
        { label: 'Message', value: 'Lunch at 1 tomorrow?\nJahaan' },
      ],
    });
    expect(t.google.gmail.users.messages.send).not.toHaveBeenCalled();

    // The AI saw the contact before deciding who to email, and the date in context.
    const secondCall = t.llm.requests[1].messages;
    expect(secondCall[0]).toMatchObject({ role: 'user', text: expect.stringMatching(/^\[Context\] Today is .*\n\nEmail Priya/) });
    expect(secondCall[secondCall.length - 1]).toMatchObject({ role: 'tool', name: 'contacts_search', isError: false });

    const second = await say('Yes, send it', first.body.conversationId);
    expect(second.body).toMatchObject({ reply: 'Sent. Your email to priya@example.com is on its way.', pendingConfirmation: null });
    expect(t.google.gmail.users.messages.send).toHaveBeenCalledTimes(1);
    expect(t.llm.requests).toHaveLength(2);

    const log = await t.prisma.actionLog.findFirstOrThrow({ where: { id: first.body.pendingConfirmation.actionId } });
    expect(log.status).toBe('SUCCEEDED');

    // "Undo" can't unsend an email, and says why.
    const undo = await say('undo that', first.body.conversationId);
    expect(undo.body.reply).toBe(
      "The last thing I did was send an email, and sent emails can't be unsent. That's why I always ask first.",
    );
  });

  it('cancels from the confirmation card, and only once', async () => {
    t.llm.replies = [
      { text: '', toolCalls: [{ id: 'call-3', name: 'gmail_send', input: { to: ['sam@example.com'], subject: 'Hi', body: 'Hello' } }] },
    ];
    const first = await say('Email sam@example.com saying hello');
    const actionId = first.body.pendingConfirmation.actionId;

    const res = await http().post(`/assistant/actions/${actionId}/confirm`).set(auth).send({ approve: false }).expect(200);
    expect(res.body.reply).toBe('Okay, I won\'t send an email to sam@example.com with the subject "Hi".');
    const again = await http().post(`/assistant/actions/${actionId}/confirm`).set(auth).send({ approve: true }).expect(200);
    expect(again.body.reply).toBe('That was already taken care of.');
    expect(t.google.gmail.users.messages.send).not.toHaveBeenCalled();
  });

  it("doesn't let one user confirm another user's action", async () => {
    t.llm.replies = [
      { text: '', toolCalls: [{ id: 'call-4', name: 'gmail_send', input: { to: ['sam@example.com'], subject: 'Hi', body: 'Hello' } }] },
    ];
    const first = await say('Email sam@example.com saying hello');
    await http()
      .post(`/assistant/actions/${first.body.pendingConfirmation.actionId}/confirm`)
      .set(otherAuth)
      .send({ approve: true })
      .expect(404);
    expect(t.google.gmail.users.messages.send).not.toHaveBeenCalled();
  });

  it('starts a fresh conversation instead of joining another user\'s', async () => {
    const mine = await say('open calendar');
    const theirs = await http().post('/assistant/turn').set(otherAuth).send({ text: 'open drive', conversationId: mine.body.conversationId });
    expect(theirs.body.conversationId).not.toBe(mine.body.conversationId);
  });

  it('cancels a waiting action when the user moves on, and keeps the history valid', async () => {
    t.llm.replies = [
      { text: '', toolCalls: [{ id: 'call-5', name: 'gmail_send', input: { to: ['sam@example.com'], subject: 'Hi', body: 'Hello' } }] },
      { text: 'You have no open tasks.', toolCalls: [] },
    ];
    const first = await say('Email sam@example.com saying hello');
    const conversationId = first.body.conversationId;
    const moved = await say('open drive', conversationId);
    expect(moved.body.reply).toBe('Opening Google Drive.');
    expect(await t.prisma.actionLog.findUniqueOrThrow({ where: { id: first.body.pendingConfirmation.actionId } })).toMatchObject({
      status: 'CANCELLED',
    });

    await say('is there anything I need to do', conversationId);
    const roles = t.llm.requests[1].messages.map((message) => message.role);
    // Every tool call is followed by its result before the next user message.
    expect(roles).toEqual(['user', 'assistant', 'tool', 'user', 'assistant', 'tool', 'assistant', 'user']);
    expect(t.llm.requests[1].messages[2]).toMatchObject({ toolCallId: 'call-5', isError: true });
  });

  it('adds a task without a second AI call, and undoes it from the activity list', async () => {
    t.llm.replies = [{ text: 'Sure!', toolCalls: [{ id: 'call-6', name: 'tasks_create', input: { title: 'Buy milk' } }] }];
    const res = await say('remind me to buy milk');
    expect(res.body.reply).toBe('Added Buy milk to your tasks.');
    expect(t.llm.requests).toHaveLength(1);

    const activity = await http().get('/assistant/actions').set(auth).expect(200);
    const item = activity.body.items.find((entry: { tool: string }) => entry.tool === 'tasks_create');
    expect(item).toMatchObject({ summary: 'Add the task "Buy milk"', status: 'SUCCEEDED', undoable: true });

    const undo = await http().post(`/assistant/actions/${item.id}/undo`).set(auth).expect(200);
    expect(undo.body.reply).toBe('I removed Buy milk from your tasks.');
    expect(t.google.tasks.tasks.delete).toHaveBeenCalledWith({ tasklist: '@default', task: 'task-1' });

    const twice = await http().post(`/assistant/actions/${item.id}/undo`).set(auth).expect(200);
    expect(twice.body.reply).toBe('That was already undone.');
    const after = await http().get('/assistant/actions').set(auth).expect(200);
    expect(after.body.items.find((entry: { id: string }) => entry.id === item.id)).toMatchObject({ status: 'UNDONE', undoable: false });
  });

  it('undoes a calendar event by voice', async () => {
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    t.llm.replies = [
      { text: '', toolCalls: [{ id: 'call-7', name: 'calendar_create_event', input: { title: 'Dentist', start: `${start}T15:00` } }] },
    ];
    const created = await say('add dentist in two days at 3 PM');
    expect(created.body.reply).toMatch(/^Done\. Dentist is on your calendar /);

    const undo = await say('undo that', created.body.conversationId);
    expect(undo.body.reply).toBe('I removed Dentist from your calendar.');
    expect(t.google.calendar.events.delete).toHaveBeenCalledWith({ calendarId: 'primary', eventId: 'event-1', sendUpdates: 'none' });
  });

  it('lets the AI fix a bad tool input', async () => {
    t.llm.replies = [
      { text: '', toolCalls: [{ id: 'call-8', name: 'calendar_create_event', input: { title: 'Gym', start: 'tomorrow 6pm' } }] },
      { text: 'What time should I put it at?', toolCalls: [] },
    ];
    const res = await say('add gym tomorrow evening');
    expect(res.body.reply).toBe('What time should I put it at?');
    const toolResult = t.llm.requests[1].messages.at(-1);
    expect(toolResult).toMatchObject({ role: 'tool', isError: true, content: expect.stringContaining('start:') });
    expect(t.google.calendar.events.insert).not.toHaveBeenCalled();
  });

  it('says what is wrong when the AI is not available', async () => {
    t.llm.replies = [new LlmError("I can't reach Ollama, the free local AI. Open the Ollama app on your Mac and try again.")];
    const res = await say('what did Sam say about the budget');
    expect(res.body.reply).toBe("I can't reach Ollama, the free local AI. Open the Ollama app on your Mac and try again.");
  });

  it('refuses to open links that are not Google pages', async () => {
    t.llm.replies = [
      { text: '', toolCalls: [{ id: 'call-9', name: 'open_link', input: { url: 'https://evil.example.com', label: 'the site' } }] },
      { text: "Sorry, I can only open Google pages.", toolCalls: [] },
    ];
    const res = await say('open the link in that email');
    expect(res.body.actions).toEqual([]);
    expect(res.body.reply).toBe('Sorry, I can only open Google pages.');
  });

  it('reports the AI status in /health', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up', llm: { provider: 'ollama', status: 'ready' } });
  });
});
