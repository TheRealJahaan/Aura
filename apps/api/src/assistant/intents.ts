import { localDateKey, startOfDayOffset } from '../common/time';
import type { GoogleApp } from '../google/links';

// Common commands are recognized here without the AI. They answer instantly,
// work even when the local AI is still loading, and always behave the same.
// Anything that doesn't match exactly goes to the AI.

export type Intent = { type: 'tool'; tool: string; input: Record<string, unknown> } | { type: 'dismiss' };

/** Lowercase, no punctuation, no "hey Aura" or "please" around the command. */
export function normalize(text: string): string {
  let result = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fillers = [
    /^(hey|hi|ok|okay|yo)\s+aura\s+/,
    /^aura\s+/,
    /^(please|can you|could you|would you|will you|i want you to|i'd like you to)\s+/,
    /\s+(please|for me|now|right now|aura)$/,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of fillers) {
      const next = result.replace(filler, '');
      if (next !== result) {
        result = next.trim();
        changed = true;
      }
    }
  }
  return result;
}

const APP_WORDS: Array<[RegExp, GoogleApp]> = [
  [/^(g ?mail|e ?mails?|mail|inbox|my inbox|my mail|my e ?mail)$/, 'gmail'],
  [/^(google )?calend[ae]r$/, 'calendar'],
  [/^(google )?drive$/, 'drive'],
  [/^(google )?docs?$/, 'docs'],
  [/^(google )?(sheets?|spreadsheets?)$/, 'sheets'],
  [/^(google )?slides?$/, 'slides'],
  [/^(google )?(tasks?|to ?dos?|to do list)$/, 'tasks'],
  [/^(google )?contacts?$/, 'contacts'],
  [/^(google )?keep$/, 'keep'],
  [/^(google )?meet$/, 'meet'],
];

function appFromWords(words: string): GoogleApp | null {
  const cleaned = words.replace(/^(my|the|up)\s+/, '').replace(/\s+app$/, '');
  for (const [pattern, app] of APP_WORDS) {
    if (pattern.test(cleaned)) return app;
  }
  return null;
}

const YES = /^(yes|yeah|yep|yup|ya|sure|ok|okay|go ahead|go for it|do it|send it|send|confirm|confirmed|please do|sounds good|absolutely|correct|that's right|that's correct|yes please|yes go ahead|yes send it|yes do it|ok go ahead|okay go ahead|affirmative|definitely)$/;
const NO = /^(no|nope|nah|don't|do not|cancel|cancel it|stop|wait|hold on|don't send it|don't do it|no thanks|no thank you|never mind|nevermind|forget it|not now|no don't)$/;

/** Reads a yes or no answer to "Should I go ahead?". Null when it's neither. */
export function parseConfirmation(text: string): boolean | null {
  const words = normalize(text);
  if (YES.test(words)) return true;
  if (NO.test(words)) return false;
  return null;
}

const DISMISS = /^(never ?mind|cancel|stop|nothing|forget it|that's all|that's it|thanks|thank you|thanks aura|ok thanks|okay thanks|bye|goodbye|go away|shut up|be quiet|you)$/;

export function matchIntent(text: string, ctx: { now: Date; timezone: string }): Intent | null {
  const t = normalize(text);
  if (!t) return { type: 'dismiss' };
  if (DISMISS.test(t)) return { type: 'dismiss' };

  const tool = (name: string, input: Record<string, unknown> = {}): Intent => ({ type: 'tool', tool: name, input });

  if (/^(start|create|make|begin|set up|open)( me)? (a )?(new )?(google )?(meet|meeting|video call|call|meet call)( link)?$/.test(t) && /\b(a|new)\b/.test(t)) {
    return tool('meet_start');
  }

  const open = /^(open|launch|show me|show|go to|pull up|bring up|take me to|start)( up)? (.+)$/.exec(t);
  const app = open ? appFromWords(open[3]) : null;
  if (app) {
    return tool('open_app', { app });
  }

  if (
    /^(brief me|briefing|give me (my|a|the) (daily |morning )?briefing|(my )?(daily|morning) briefing|brief me on (my|the) day|what's my day( like| look like)?|what is my day( like| look like)?|how's my day( looking)?|how is my day( looking)?|what does my day look like|good morning)$/.test(t)
  ) {
    return tool('daily_briefing');
  }

  const prep = /^prep(are)? me( for (.+))?$/.exec(t);
  if (prep) {
    const target = (prep[3] ?? '').replace(/^(my|the|our)\s+/, '').replace(/\s+(meeting|call)$/, '').trim();
    const generic = /^(next|upcoming|next meeting|upcoming meeting|meeting|call|next call)?$/.test(target);
    return tool('meeting_prep', generic ? {} : { query: target });
  }

  if (
    /^(what's next|what is next|what's up next|what's my next (meeting|event)|what is my next (meeting|event)|when's my next (meeting|event)|when is my next (meeting|event)|next meeting|my next meeting)$/.test(t)
  ) {
    return tool('calendar_next_event');
  }

  if (/^(join|open|start|get me into) (my|the) (next )?(meeting|call|video call|meet)$/.test(t)) {
    return tool('meeting_join');
  }

  if (/^(undo|undo that|undo it|undo the last (thing|action|one)|take that back|revert that|reverse that)$/.test(t)) {
    return tool('undo_last_action');
  }

  if (/^(any (new |unread )?e ?mails?|do i have (any )?(new |unread )?e ?mails?|read my e ?mails?|check (my )?(e ?mails?|mail|inbox))$/.test(t)) {
    return tool('gmail_search', { query: 'is:unread in:inbox', maxResults: 5 });
  }

  const agenda =
    /^(?:what's|what is|what do i have) on my calendar( today| tomorrow)?$|^(?:what's|what is) my schedule( today| tomorrow)?$|^check (?:my )?calendar( today| tomorrow)?$/.exec(t);
  if (agenda) {
    const day = (agenda[1] ?? agenda[2] ?? agenda[3] ?? '').trim();
    if (day === 'tomorrow') {
      return tool('calendar_list_events', { start: localDateKey(startOfDayOffset(ctx.now, 1, ctx.timezone), ctx.timezone) });
    }
    return tool('calendar_list_events');
  }

  if (/^(what are my tasks|what's on my to ?do list|what is on my to ?do list|my tasks|list my tasks|show my tasks|what do i need to do( today)?)$/.test(t)) {
    return tool('tasks_list');
  }

  return null;
}
