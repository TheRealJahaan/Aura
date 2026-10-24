import type { AppState, AuraBridge, GoogleService, PendingConfirmation, Result, TurnResponse } from '../shared/bridge';
import { EndpointDetector } from '../shared/audio';
import { ERROR_COLORS, orbColors, prettyHotkey } from './colors';
import { captureFrames, startWakeWord } from './mic';

declare global {
  interface Window {
    aura: AuraBridge;
  }
}

type Mode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'confirm' | 'error';

const aura = window.aura;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  orb: $('orb'),
  status: $('status'),
  heard: $('heard'),
  reply: $('reply'),
  confirm: $('confirm'),
  confirmTitle: $('confirm-title'),
  confirmDetails: $('confirm-details'),
  approve: $<HTMLButtonElement>('approve'),
  cancel: $<HTMLButtonElement>('cancel'),
  typeForm: $<HTMLFormElement>('type-form'),
  typeInput: $<HTMLInputElement>('type-input'),
  typeToggle: $('type-toggle'),
  hint: $('hint'),
  close: $('close'),
};

const STATUS: Record<Mode, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  confirm: 'Waiting for your OK',
  error: 'Something went wrong',
};

let mode: Mode = 'idle';
let conversationId: string | undefined;
let pending: PendingConfirmation | null = null;
let lastReply = '';
let stopCapture: (() => Promise<void>) | null = null;
let hideTimer: number | undefined;
let busy = false;

function setMode(next: Mode): void {
  mode = next;
  document.body.dataset.mode = next;
  ui.status.textContent = STATUS[next];
}

function tint(colors: string[]): void {
  colors.forEach((color, i) => document.documentElement.style.setProperty(`--c${i + 1}`, color));
}

function setLevel(level: number): void {
  document.documentElement.style.setProperty('--level', level.toFixed(2));
}

function cancelHide(): void {
  window.clearTimeout(hideTimer);
}

function scheduleHide(ms: number): void {
  cancelHide();
  hideTimer = window.setTimeout(() => {
    if (mode === 'idle' && !pending && ui.typeForm.hidden) void close();
  }, ms);
}

async function close(): Promise<void> {
  cancelHide();
  await stopListening();
  void aura.stopSpeaking();
  ui.typeForm.hidden = true;
  showConfirmation(null);
  ui.heard.textContent = '';
  ui.reply.textContent = '';
  tint(orbColors([]));
  setMode('idle');
  void aura.hideOrb();
}

/** A short rising tone so you know Aura heard its name. */
function chime(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => void ctx.close();
  } catch {
    // No audio output: the orb animation is enough.
  }
}

async function stopListening(): Promise<void> {
  const stop = stopCapture;
  stopCapture = null;
  setLevel(0);
  if (stop) await stop();
}

async function startListening(): Promise<void> {
  if (mode === 'listening' || busy) return;
  cancelHide();
  void aura.stopSpeaking();
  await aura.showOrb(false);
  setMode('listening');
  chime();
  const detector = new EndpointDetector();
  let finished = false;
  try {
    stopCapture = await captureFrames((frame) => {
      if (finished) return;
      const state = detector.feed(frame);
      setLevel(detector.level);
      if (state !== 'listening') {
        finished = true;
        void finishListening(state === 'done' ? detector.audio() : null);
      }
    });
  } catch (err) {
    showError(`Aura can't use the microphone: ${(err as Error).message}. You can type instead.`);
    showTyping();
  }
}

async function finishListening(audio: Float32Array | null): Promise<void> {
  await stopListening();
  if (!audio) {
    // Nobody spoke. Go back quietly.
    setMode(pending ? 'confirm' : 'idle');
    scheduleHide(4000);
    return;
  }
  setMode('thinking');
  const heard = await aura.transcribe(audio);
  if (!heard.ok) {
    showError(heard.error);
    return;
  }
  if (!heard.value) {
    ui.heard.textContent = '';
    ui.reply.textContent = "I didn't catch that.";
    setMode(pending ? 'confirm' : 'idle');
    scheduleHide(4000);
    return;
  }
  await send(heard.value);
}

async function send(text: string): Promise<void> {
  if (busy) return;
  busy = true;
  ui.heard.textContent = `“${text}”`;
  ui.reply.textContent = '';
  setMode('thinking');
  try {
    await handleResult(await aura.turn(text, conversationId));
  } finally {
    busy = false;
  }
}

async function handleResult(result: Result<TurnResponse>): Promise<void> {
  if (!result.ok) {
    showError(result.error);
    return;
  }
  const response = result.value;
  conversationId = response.conversationId;
  tint(orbColors(response.services as GoogleService[]));
  lastReply = response.reply;
  ui.reply.textContent = response.reply;
  showConfirmation(response.pendingConfirmation);
  setMode('speaking');
  void aura.speak(response.reply);
}

function showConfirmation(confirmation: PendingConfirmation | null): void {
  pending = confirmation;
  ui.confirm.hidden = !confirmation;
  ui.confirmDetails.replaceChildren();
  if (!confirmation) return;
  ui.confirmTitle.textContent = `${confirmation.summary}?`;
  for (const row of confirmation.details) {
    const dt = document.createElement('dt');
    dt.textContent = row.label;
    const dd = document.createElement('dd');
    dd.textContent = row.value; // text, never HTML: an email body can't inject anything
    ui.confirmDetails.append(dt, dd);
  }
}

async function answer(approve: boolean): Promise<void> {
  if (!pending || busy) return;
  const { actionId } = pending;
  busy = true;
  await stopListening();
  void aura.stopSpeaking();
  showConfirmation(null);
  setMode('thinking');
  try {
    await handleResult(await aura.confirm(actionId, approve));
  } finally {
    busy = false;
  }
}

function showError(message: string): void {
  tint(ERROR_COLORS);
  ui.reply.textContent = message;
  setMode('error');
  lastReply = '';
  void aura.speak(message);
  window.setTimeout(() => {
    if (mode === 'error') {
      tint(orbColors([]));
      setMode('idle');
      scheduleHide(8000);
    }
  }, 2500);
}

function onSpeechDone(): void {
  if (mode !== 'speaking') return;
  // After a question (or "Should I go ahead?"), listen for the answer without the wake word.
  if (pending || lastReply.trim().endsWith('?')) {
    void startListening();
    return;
  }
  setMode('idle');
  scheduleHide(6000);
}

function showTyping(): void {
  cancelHide();
  void aura.showOrb(true);
  ui.typeForm.hidden = false;
  ui.typeInput.focus();
}

function renderHint(state: AppState): void {
  const hotkey = prettyHotkey(state.hotkey, navigator.platform.startsWith('Mac'));
  if (!state.user) {
    ui.hint.textContent = 'Sign in from the Aura window first';
  } else if (state.wake.state === 'listening') {
    ui.hint.textContent = `Say “${state.wake.label}” or press ${hotkey}`;
  } else {
    ui.hint.textContent = `Press ${hotkey} to talk`;
  }
}

async function init(): Promise<void> {
  setMode('idle');
  tint(orbColors([]));
  aura.onStateChanged(renderHint);
  aura.onListen(() => void startListening());
  aura.onType(showTyping);
  aura.onSpeechDone(onSpeechDone);

  ui.orb.addEventListener('click', () => void (mode === 'listening' ? stopListening().then(() => setMode('idle')) : startListening()));
  ui.approve.addEventListener('click', () => void answer(true));
  ui.cancel.addEventListener('click', () => void answer(false));
  ui.close.addEventListener('click', () => void close());
  ui.typeToggle.addEventListener('click', showTyping);
  ui.typeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = ui.typeInput.value.trim();
    if (!text) return;
    ui.typeInput.value = '';
    void send(text);
  });
  document.addEventListener('mouseenter', cancelHide);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void (pending ? answer(false) : close());
    if (event.key === 'Enter' && pending && document.activeElement !== ui.typeInput) void answer(true);
  });

  renderHint(await aura.getState());
  const status = await startWakeWord(await aura.wakeConfig(), () => void startListening());
  await aura.reportWake(status);
}

void init();
