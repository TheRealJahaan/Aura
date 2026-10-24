// Starts the real Aura app (Electron) against a tiny fake API and checks that
// both windows load, the bridge works, and nothing logs an error.
// Run with: npm run test:smoke  (on Linux without a screen: xvfb-run -a npm run test:smoke)
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const api = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok', database: 'up', version: '0.1.0', uptimeSeconds: 1, llm: { provider: 'ollama', model: 'qwen3:8b', status: 'ready' } }));
  } else {
    res.statusCode = 401;
    res.end(JSON.stringify({ message: 'Sign in to Aura first.' }));
  }
});
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
const apiUrl = `http://127.0.0.1:${api.address().port}`;

const env = { ...process.env, AURA_API_URL: apiUrl, AURA_OPEN_DASHBOARD: '1', PICOVOICE_ACCESS_KEY: '', AURA_SPEAK: 'off' };
delete env.NODE_OPTIONS; // Electron rejects some Node flags
const app = await electron.launch({
  args: ['.', '--no-sandbox', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'aura-smoke-'))}`],
  env,
});
const errors = [];
try {
  const dashboard = await app.waitForEvent('window', { predicate: (page) => page.url().endsWith('/dashboard.html'), timeout: 20_000 }).catch(() => null)
    ?? app.windows().find((page) => page.url().endsWith('/dashboard.html'));
  assert.ok(dashboard, 'dashboard window opened');
  dashboard.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await dashboard.waitForSelector('#sign-in', { timeout: 15_000 });
  const pills = await dashboard.locator('#pills').innerText();
  assert.match(pills, /Server/);
  assert.match(pills, /AI: qwen3:8b/);
  assert.match(pills, /Signed out/);

  const orb = app.windows().find((page) => page.url().endsWith('/orb.html'));
  assert.ok(orb, 'orb window loaded');
  assert.equal(await orb.evaluate(() => typeof window.aura.turn), 'function');
  assert.equal(await orb.evaluate(() => typeof (window).require), 'undefined', 'no Node in pages');
  const turn = await orb.evaluate(() => window.aura.turn('open mail'));
  assert.equal(turn.ok, false);
  assert.match(turn.error, /Sign in to Aura first/);
  const blocked = await orb.evaluate(() => window.aura.undo('not-a-uuid').then(() => 'allowed', (e) => String(e)));
  assert.match(blocked, /Invalid request/);
  assert.deepEqual(errors, []);
  console.log('Electron smoke test passed');
} finally {
  await app.close();
  api.close();
}
