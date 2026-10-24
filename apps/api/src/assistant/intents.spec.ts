import { matchIntent, normalize, parseConfirmation } from './intents';

const ctx = { now: new Date('2026-10-24T03:30:00.000Z'), timezone: 'Asia/Kolkata' };
const toolOf = (text: string) => {
  const intent = matchIntent(text, ctx);
  return intent?.type === 'tool' ? [intent.tool, intent.input] : intent?.type ?? null;
};

describe('normalize', () => {
  it('drops punctuation, case, wake words and politeness', () => {
    expect(normalize('Hey Aura, open Gmail please!')).toBe('open gmail');
    expect(normalize('  Could you   OPEN my calendar? ')).toBe('open my calendar');
    expect(normalize('Aura. What’s next?')).toBe("what's next");
  });
});

describe('matchIntent', () => {
  it.each([
    ['open mail', 'gmail'],
    ['Open Gmail.', 'gmail'],
    ['open my inbox', 'gmail'],
    ['open email', 'gmail'],
    ['launch calendar', 'calendar'],
    ['show me google drive', 'drive'],
    ['open sheets', 'sheets'],
    ['open google docs', 'docs'],
    ['open my tasks', 'tasks'],
    ['open contacts', 'contacts'],
    ['open keep', 'keep'],
  ])('"%s" opens %s', (text, app) => {
    expect(toolOf(text)).toEqual(['open_app', { app }]);
  });

  it.each([
    ['Brief me', 'daily_briefing', {}],
    ['give me my daily briefing', 'daily_briefing', {}],
    ["what's my day look like", 'daily_briefing', {}],
    ['Good morning!', 'daily_briefing', {}],
    ['prep me', 'meeting_prep', {}],
    ['Prep me for my next meeting', 'meeting_prep', {}],
    ['prepare me for the design review', 'meeting_prep', { query: 'design review' }],
    ["what's next?", 'calendar_next_event', {}],
    ['when is my next meeting', 'calendar_next_event', {}],
    ['join my meeting', 'meeting_join', {}],
    ['start the meeting', 'meeting_join', {}],
    ['start a meeting', 'meet_start', {}],
    ['start a new google meet', 'meet_start', {}],
    ['undo that', 'undo_last_action', {}],
    ['take that back', 'undo_last_action', {}],
    ['check my email', 'gmail_search', { query: 'is:unread in:inbox', maxResults: 5 }],
    ['any new emails?', 'gmail_search', { query: 'is:unread in:inbox', maxResults: 5 }],
    ["what's on my calendar", 'calendar_list_events', {}],
    ['check my calendar today', 'calendar_list_events', {}],
    ["what's on my calendar tomorrow", 'calendar_list_events', { start: '2026-10-25' }],
    ['what are my tasks', 'tasks_list', {}],
  ])('"%s" runs %s', (text, tool, input) => {
    expect(toolOf(text)).toEqual([tool, input]);
  });

  it.each(['never mind', 'Thank you.', 'thanks', 'you', '...'])('"%s" dismisses', (text) => {
    expect(toolOf(text)).toBe('dismiss');
  });

  it.each([
    'email Priya about lunch tomorrow',
    'open the email from Priya',
    'what did Sam say about the budget',
    'add dentist on Monday at 3',
    'remind me to call mom',
    'open my meeting notes from yesterday',
  ])('"%s" goes to the AI', (text) => {
    expect(matchIntent(text, ctx)).toBeNull();
  });
});

describe('parseConfirmation', () => {
  it.each(['yes', 'Yes, go ahead.', 'yeah', 'send it', 'OK', 'sure', 'do it please'])('"%s" is yes', (text) => {
    expect(parseConfirmation(text)).toBe(true);
  });
  it.each(['no', 'Nope.', "don't send it", 'cancel', 'wait', 'never mind'])('"%s" is no', (text) => {
    expect(parseConfirmation(text)).toBe(false);
  });
  it.each(['yes but change the subject to Hi', 'send it to Sam instead', 'what time is it'])('"%s" is neither', (text) => {
    expect(parseConfirmation(text)).toBeNull();
  });
});
