import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runActions } from '../../src/main/actions';
import { ApiClient, ApiError } from '../../src/main/api-client';
import { challengeFor, createVerifier, startLoopbackLogin } from '../../src/main/login';
import { SessionStore } from '../../src/main/session-store';
import { Speaker } from '../../src/main/speaker';
import { cleanTranscript, Transcriber, WorkerHandle, WorkerRequest, WorkerResponse } from '../../src/main/transcriber';

describe('SessionStore', () => {
  const encryptor = (available: boolean) => ({
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
  });

  it('stores the token encrypted', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'aura-')), 'session.bin');
    new SessionStore(file, encryptor(true)).save('aura_secret');
    expect(readFileSync(file, 'utf8')).toBe('enc:aura_secret');
    expect(new SessionStore(file, encryptor(true)).load()).toBe('aura_secret');
  });

  it('never writes plain text when encryption is unavailable', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'aura-')), 'session.bin');
    const store = new SessionStore(file, encryptor(false));
    store.save('aura_secret');
    expect(store.load()).toBe('aura_secret');
    expect(() => readFileSync(file)).toThrow();
    store.clear();
    expect(store.load()).toBeNull();
  });
});

describe('ApiClient', () => {
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('sends the bearer token and validates answers', async () => {
    const fetchImpl = jest.fn().mockReturnValue(
      json(200, { conversationId: 'c', reply: 'Hi', actions: [], pendingConfirmation: null, services: [] }),
    );
    const api = new ApiClient('http://127.0.0.1:3000', () => 'aura_t', fetchImpl);
    await expect(api.turn({ text: 'hi' })).resolves.toMatchObject({ reply: 'Hi' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3000/assistant/turn');
    expect(init.headers.authorization).toBe('Bearer aura_t');
  });

  it('explains common failures', async () => {
    const offline = new ApiClient('http://127.0.0.1:3000', () => 't', jest.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(offline.activity()).rejects.toMatchObject({ unreachable: true, message: expect.stringContaining('npm run api') });
    const expired = new ApiClient('http://x', () => 't', jest.fn().mockReturnValue(json(401, {})));
    await expect(expired.me()).rejects.toMatchObject({ status: 401 });
    const bad = new ApiClient('http://x', () => 't', jest.fn().mockReturnValue(json(400, { message: ['text: too long'] })));
    await expect(bad.turn({ text: 'x' })).rejects.toThrow('text: too long');
    const noToken = new ApiClient('http://x', () => null, jest.fn());
    await expect(noToken.me()).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects answers in an unexpected shape', async () => {
    const api = new ApiClient('http://x', () => 't', jest.fn().mockReturnValue(json(200, { reply: 5 })));
    await expect(api.turn({ text: 'x' })).rejects.toThrow('does not understand');
  });
});

describe('loopback sign-in', () => {
  it('makes RFC 7636 verifiers and challenges', () => {
    const verifier = createVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('receives the code on 127.0.0.1 and ignores everything else', async () => {
    const login = await startLoopbackLogin('http://127.0.0.1:3000');
    const url = new URL(login.startUrl);
    expect(url.pathname).toBe('/auth/google/start');
    expect(url.searchParams.get('challenge')).toBe(challengeFor(login.verifier));
    const port = url.searchParams.get('port');
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/callback?code=bad`)).status).toBe(400);
    const ok = await fetch(`http://127.0.0.1:${port}/callback?code=${'a'.repeat(43)}`);
    expect(await ok.text()).toContain("You're signed in");
    await expect(login.code).resolves.toBe('a'.repeat(43));
  });

  it('can be cancelled', async () => {
    const login = await startLoopbackLogin('http://127.0.0.1:3000');
    login.cancel();
    await expect(login.code).rejects.toThrow('cancelled');
  });
});

describe('runActions', () => {
  it('opens only Google pages', async () => {
    const open = jest.fn().mockResolvedValue(undefined);
    const opened = await runActions(
      [
        { type: 'open_url', url: 'https://mail.google.com/mail/u/', label: 'Gmail' },
        { type: 'open_url', url: 'https://evil.example.com', label: 'Evil' },
        { type: 'open_url', url: 'file:///etc/passwd', label: 'File' },
      ],
      open,
    );
    expect(opened).toEqual(['https://mail.google.com/mail/u/']);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('Speaker', () => {
  function fakeSpawn() {
    const children: Array<EventEmitter & { stdin: { end: jest.Mock }; kill: jest.Mock; exitCode: number | null }> = [];
    const spawnImpl = jest.fn(() => {
      const child = Object.assign(new EventEmitter(), { stdin: { end: jest.fn() }, kill: jest.fn(), exitCode: null as number | null });
      child.kill.mockImplementation(() => child.emit('exit', null));
      children.push(child);
      return child;
    });
    return { spawnImpl, children };
  }

  it('speaks with say, passing text on stdin', async () => {
    const { spawnImpl, children } = fakeSpawn();
    const speaker = new Speaker({ enabled: true, voice: 'Samantha', platform: 'darwin', spawnImpl: spawnImpl as never });
    const done = jest.fn();
    speaker.on('done', done);
    const finished = speaker.speak('-v Evil  Hello\nthere');
    expect(spawnImpl).toHaveBeenCalledWith('say', ['-v', 'Samantha'], expect.anything());
    expect(children[0].stdin.end).toHaveBeenCalledWith('-v Evil Hello there');
    children[0].emit('exit', 0);
    await finished;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('does not report "done" when interrupted', async () => {
    const { spawnImpl } = fakeSpawn();
    const speaker = new Speaker({ enabled: true, voice: null, platform: 'darwin', spawnImpl: spawnImpl as never });
    const done = jest.fn();
    speaker.on('done', done);
    const first = speaker.speak('one');
    speaker.stop();
    await first;
    expect(done).not.toHaveBeenCalled();
  });

  it('is silent off macOS but still finishes', async () => {
    const speaker = new Speaker({ enabled: true, voice: null, platform: 'linux' });
    const done = jest.fn();
    speaker.on('done', done);
    await speaker.speak('hello');
    expect(speaker.available).toBe(false);
    expect(done).toHaveBeenCalled();
  });
});

describe('Transcriber', () => {
  function fakeWorker() {
    const emitter = new EventEmitter();
    const sent: WorkerRequest[] = [];
    const handle: WorkerHandle = {
      postMessage: (m) => sent.push(m),
      on: (event: string, listener: (arg: WorkerResponse & number) => void) => {
        emitter.on(event, listener);
      },
      kill: () => true,
    } as WorkerHandle;
    return { handle, sent, reply: (m: WorkerResponse) => emitter.emit('message', m), exit: () => emitter.emit('exit', 1) };
  }

  it('loads the model once and returns text', async () => {
    const worker = fakeWorker();
    const t = new Transcriber(() => worker.handle, { model: 'm', cacheDir: '/c' });
    const text = t.transcribe(new Float32Array(10));
    expect(worker.sent[0]).toEqual({ type: 'load', model: 'm', cacheDir: '/c' });
    expect(worker.sent[1]).toMatchObject({ type: 'transcribe', id: 1 });
    worker.reply({ type: 'result', id: 1, text: 'open mail' });
    await expect(text).resolves.toBe('open mail');
  });

  it('fails pending work if the worker dies or the model cannot load', async () => {
    const worker = fakeWorker();
    const t = new Transcriber(() => worker.handle, { model: 'm', cacheDir: '/c' });
    const a = t.transcribe(new Float32Array(1));
    worker.reply({ type: 'error', id: null, message: "I couldn't download the speech model." });
    await expect(a).rejects.toThrow('download');
    const b = t.transcribe(new Float32Array(1));
    worker.exit();
    await expect(b).rejects.toThrow('stopped unexpectedly');
  });

  it('drops things Whisper hears in silence', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] ')).toBe('');
    expect(cleanTranscript('(music) Open mail. *cough*')).toBe('Open mail.');
  });
});
