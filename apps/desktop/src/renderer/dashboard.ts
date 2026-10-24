import type { ActivityResponse, AppState, AuraBridge, PendingConfirmation, Result, TurnResponse } from '../shared/bridge';
import { prettyHotkey } from './colors';

declare global {
  interface Window {
    aura: AuraBridge;
  }
}

const aura = window.aura;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const EXAMPLES = [
  'Brief me',
  'Open mail',
  'Prep me for my next meeting',
  "What's next?",
  'Remind me to call mom tomorrow',
  'Add lunch with Sam on Friday at 1 PM',
  'Do I have any new emails?',
  'Start a meeting',
  'Undo that',
];

const SERVICE_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  calendar: 'Calendar',
  tasks: 'Tasks',
  drive: 'Drive',
  contacts: 'Contacts',
};

let state: AppState | null = null;
let conversationId: string | undefined;
let pending: PendingConfirmation | null = null;

/** Builds an element with text content only (never HTML from the outside). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { className?: string; text?: string } = {}, ...children: Node[]) {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

function code(text: string): HTMLElement {
  return el('code', { text });
}

function renderPills(s: AppState): void {
  const pills: Array<[string, 'ok' | 'warn' | 'bad', string]> = [];
  pills.push(s.apiReachable ? ['Server', 'ok', 'Server is running'] : ['Server offline', 'bad', 'Start it with npm run api']);
  const llm = s.health?.llm;
  if (llm) {
    pills.push(llm.status === 'ready' ? [`AI: ${llm.model}`, 'ok', `${llm.provider} is ready`] : ['AI not ready', 'bad', llm.detail ?? llm.status]);
  }
  if (s.apiReachable) {
    pills.push(s.user ? ['Google', s.user.google.missingServices.length ? 'warn' : 'ok', s.user.email] : ['Signed out', 'warn', 'Sign in with Google']);
  }
  pills.push(
    s.wake.state === 'listening'
      ? [`Wake word: ${s.wake.label}`, 'ok', 'Listening for the wake word']
      : s.wake.state === 'error'
        ? ['Wake word error', 'bad', s.wake.detail ?? '']
        : [`${prettyHotkey(s.hotkey)} to talk`, 'warn', s.wake.detail ?? 'No wake word set up'],
  );
  pills.push(s.voice ? ['Voice on', 'ok', 'Aura speaks with your Mac voice'] : ['Voice off', 'warn', 'Spoken replies are off']);
  $('pills').replaceChildren(
    ...pills.map(([label, level, title]) => {
      const li = el('li', { className: `pill ${level}`, text: label });
      li.title = title;
      return li;
    }),
  );
}

function renderAccount(s: AppState): void {
  const body = $('account-body');
  if (!s.user) {
    const button = el('button', { className: 'google-btn' }, el('span', { className: 'g' }), document.createTextNode('Sign in with Google'));
    button.id = 'sign-in';
    button.disabled = !s.apiReachable;
    const note = el('p', {
      className: 'muted',
      text: 'Your browser opens Google’s own sign-in page. Aura never sees your password, and your Google token is stored encrypted on this Mac.',
    });
    const message = el('p', { className: 'muted' });
    message.id = 'sign-in-message';
    button.addEventListener('click', async () => {
      button.disabled = true;
      message.textContent = 'Finish signing in in your browser…';
      const result = await aura.signIn();
      message.textContent = result.ok ? '' : result.error;
      button.disabled = false;
      await refresh();
    });
    body.replaceChildren(note, button, message);
    return;
  }
  const user = s.user;
  const avatar = el('div', { className: 'avatar' });
  if (user.avatarUrl?.startsWith('https://')) {
    const img = el('img');
    img.src = user.avatarUrl;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    avatar.append(img);
  } else {
    avatar.textContent = (user.name ?? user.email).charAt(0).toUpperCase();
  }
  const who = el('div', {}, el('strong', { text: user.name ?? user.email }), el('div', { className: 'muted', text: `${user.email} · ${user.timezone}` }));
  const services = el(
    'ul',
    { className: 'services' },
    ...Object.entries(SERVICE_NAMES).map(([key, name]) => {
      const missing = user.google.missingServices.includes(key);
      const li = el('li', { className: missing ? 'missing' : '', text: missing ? `${name}: not allowed` : `✓ ${name}` });
      if (missing) li.title = 'Sign out and sign in again, and tick this service on Google’s consent screen.';
      return li;
    }),
  );
  const signOut = el('button', { className: 'secondary', text: 'Sign out' });
  signOut.addEventListener('click', async () => {
    await aura.signOut();
    await refresh();
  });
  const disconnect = el('button', { className: 'danger', text: 'Disconnect Google' });
  disconnect.title = 'Removes Aura’s access at Google and deletes the stored token.';
  disconnect.addEventListener('click', async () => {
    if (!window.confirm('Disconnect Google? Aura will lose access until you sign in again.')) return;
    await aura.disconnectGoogle();
    await refresh();
  });
  body.replaceChildren(el('div', { className: 'user' }, avatar, who), services, el('div', { className: 'row' }, signOut, disconnect));
}

function renderSetup(s: AppState): void {
  const steps: HTMLElement[] = [];
  if (!s.apiReachable) {
    steps.push(el('li', {}, document.createTextNode('Start the Aura server in Terminal: '), code('npm run api')));
  }
  const llm = s.health?.llm;
  if (llm && llm.status !== 'ready') {
    steps.push(el('li', { text: llm.detail ?? `The AI (${llm.provider}) is not ready.` }));
  }
  if (s.apiReachable && !s.user) {
    steps.push(el('li', { text: 'Sign in with Google (left).' }));
  }
  if (s.wake.state !== 'listening') {
    steps.push(el('li', { text: s.wake.detail ?? `Optional: set up a wake word. Until then, press ${prettyHotkey(s.hotkey)}.` }));
  }
  $('setup').hidden = steps.length === 0;
  $('setup-list').replaceChildren(...steps);
}

function render(s: AppState): void {
  state = s;
  renderPills(s);
  renderAccount(s);
  renderSetup(s);
}

function showAnswer(result: Result<TurnResponse>): void {
  $('answer').hidden = false;
  if (!result.ok) {
    $('answer-text').textContent = result.error;
    showPending(null);
    return;
  }
  conversationId = result.value.conversationId;
  $('answer-text').textContent = result.value.reply;
  showPending(result.value.pendingConfirmation);
  void loadActivity();
}

function showPending(confirmation: PendingConfirmation | null): void {
  pending = confirmation;
  $('answer-confirm').hidden = !confirmation;
  $('answer-details').replaceChildren(
    ...(confirmation?.details ?? []).flatMap((row) => [el('dt', { text: row.label }), el('dd', { text: row.value })]),
  );
}

async function ask(text: string): Promise<void> {
  const input = $<HTMLInputElement>('ask-input');
  input.disabled = true;
  $('answer').hidden = false;
  $('answer-text').textContent = 'Thinking…';
  showPending(null);
  try {
    showAnswer(await aura.turn(text, conversationId));
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function answer(approve: boolean): Promise<void> {
  if (!pending) return;
  const id = pending.actionId;
  showPending(null);
  $('answer-text').textContent = approve ? 'Working on it…' : 'Cancelling…';
  showAnswer(await aura.confirm(id, approve));
}

function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATUS_LABELS: Record<string, string> = {
  PENDING_CONFIRMATION: 'Waiting for OK',
  SUCCEEDED: 'Done',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  UNDONE: 'Undone',
};

function renderActivity(result: Result<ActivityResponse>): void {
  const log = $('log');
  if (!result.ok) {
    log.replaceChildren(el('li', { className: 'empty', text: state?.user ? result.error : 'Sign in to see what Aura did.' }));
    return;
  }
  if (result.value.items.length === 0) {
    log.replaceChildren(el('li', { className: 'empty', text: 'Nothing yet. Try “Remind me to call mom tomorrow”.' }));
    return;
  }
  log.replaceChildren(
    ...result.value.items.map((item) => {
      const right = el('div', { className: 'row' }, el('span', { className: `status ${item.status}`, text: STATUS_LABELS[item.status] ?? item.status }));
      if (item.undoable) {
        const undo = el('button', { className: 'secondary', text: 'Undo' });
        undo.addEventListener('click', async () => {
          undo.disabled = true;
          const res = await aura.undo(item.id);
          $('answer').hidden = false;
          $('answer-text').textContent = res.ok ? res.value.reply : res.error;
          await loadActivity();
        });
        right.append(undo);
      }
      const detail = el('span', { className: 'when', text: item.error ? `${timeAgo(item.createdAt)} · ${item.error}` : timeAgo(item.createdAt) });
      return el('li', {}, el('span', { text: item.summary }), right, detail);
    }),
  );
}

async function loadActivity(): Promise<void> {
  renderActivity(await aura.activity());
}

async function refresh(): Promise<void> {
  render(await aura.getState());
  await loadActivity();
}

function init(): void {
  $('examples').replaceChildren(
    ...EXAMPLES.map((text) => {
      const button = el('button', { text });
      button.addEventListener('click', () => void ask(text));
      return el('li', {}, button);
    }),
  );
  $('ask-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $<HTMLInputElement>('ask-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    void ask(text);
  });
  $('answer-approve').addEventListener('click', () => void answer(true));
  $('answer-cancel').addEventListener('click', () => void answer(false));
  $('refresh').addEventListener('click', () => void refresh());
  aura.onStateChanged(render);
  window.setInterval(() => {
    if (document.visibilityState === 'visible' && state?.user) void loadActivity();
  }, 15_000);
  void refresh();
}

init();
