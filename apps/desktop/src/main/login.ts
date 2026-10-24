import { createHash, randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// Google sign-in for a desktop app (RFC 8252). The app listens on a random
// port on 127.0.0.1 and proves it started the sign-in with PKCE: it keeps a
// random "verifier" and only ever sends its SHA-256 hash until the very end.

export function createVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const CODE = /^[A-Za-z0-9_-]{20,200}$/;

function page(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0b0b12;color:#f4f4f8}
main{text-align:center}.orb{width:72px;height:72px;margin:0 auto 20px;border-radius:50%;background:conic-gradient(#4285F4,#EA4335,#FBBC04,#34A853,#4285F4);filter:blur(1px)}</style>
</head><body><main><div class="orb"></div><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

export interface LoopbackLogin {
  /** Resolves with the one-time code once the browser comes back. */
  code: Promise<string>;
  verifier: string;
  startUrl: string;
  cancel(): void;
}

/** Starts the local server and returns the URL to open in the browser. */
export async function startLoopbackLogin(apiUrl: string, timeoutMs = 5 * 60_000): Promise<LoopbackLogin> {
  const verifier = createVerifier();
  let settle: { resolve: (code: string) => void; reject: (err: Error) => void } | null = null;
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/callback') {
      res.writeHead(404, { connection: 'close' }).end();
      return;
    }
    const received = url.searchParams.get('code') ?? '';
    if (!CODE.test(received)) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end(page('Sign-in failed', 'Start again from the Aura app.'));
      return;
    }
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' })
      .end(page("You're signed in", 'You can close this tab and go back to Aura.'));
    finish(null, received);
  });

  const timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), timeoutMs);
  timer.unref();
  function finish(err: Error | null, value?: string) {
    clearTimeout(timer);
    server.close();
    server.closeIdleConnections();
    const current = settle;
    settle = null;
    if (!current) return;
    if (err) current.reject(err);
    else current.resolve(value as string);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const startUrl = `${apiUrl}/auth/google/start?challenge=${challengeFor(verifier)}&port=${port}`;
  return { code, verifier, startUrl, cancel: () => finish(new Error('Sign-in was cancelled.')) };
}
