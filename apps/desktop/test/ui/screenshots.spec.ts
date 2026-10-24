import { test } from '@playwright/test';
import { mockBridge } from './mock-bridge';

// Captures the images in the README. Run with: SCREENSHOTS=1 npx playwright test screenshots
test.skip(!process.env.SCREENSHOTS, 'only when SCREENSHOTS=1');

const out = (name: string) => `../../docs/images/${name}`;

test('dashboard', async ({ page }) => {
  await mockBridge(page, {
    responses: {
      activity: {
        ok: true,
        value: {
          items: [
            { id: '11111111-1111-4111-8111-111111111111', tool: 'calendar_create_event', summary: 'Add "Lunch with Sam" to your calendar on Friday at 1 PM', status: 'SUCCEEDED', error: null, createdAt: new Date(Date.now() - 120_000).toISOString(), undoable: true },
            { id: '22222222-2222-4222-8222-222222222222', tool: 'gmail_send', summary: 'Send an email to priya@example.com with the subject "Q3 numbers"', status: 'SUCCEEDED', error: null, createdAt: new Date(Date.now() - 900_000).toISOString(), undoable: false },
            { id: '33333333-3333-4333-8333-333333333333', tool: 'tasks_create', summary: 'Add the task "Call mom", due tomorrow', status: 'UNDONE', error: null, createdAt: new Date(Date.now() - 3_600_000).toISOString(), undoable: false },
          ],
        },
      },
    },
  });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/dashboard.html');
  await page.waitForSelector('.log li');
  await page.screenshot({ path: out('dashboard.png') });
});

test('orb confirm', async ({ page }) => {
  await mockBridge(page, {
    responses: {
      'turn:x': {
        ok: true,
        value: {
          conversationId: 'c1',
          reply: 'I\'m about to send an email to priya@example.com with the subject "Lunch". Should I go ahead?',
          actions: [],
          pendingConfirmation: {
            actionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
            summary: 'Send an email to priya@example.com with the subject "Lunch"',
            details: [
              { label: 'To', value: 'priya@example.com' },
              { label: 'Subject', value: 'Lunch' },
              { label: 'Message', value: 'Hi Priya, lunch tomorrow at 1?\nJahaan' },
            ],
          },
          services: ['gmail'],
        },
      },
    },
  });
  await page.setViewportSize({ width: 380, height: 460 });
  await page.goto('/orb.html');
  await page.evaluate(() => (document.body.style.background = 'linear-gradient(135deg,#1e293b,#0f172a)'));
  await page.evaluate(() => window.aura.turn('x').then((r) => r));
  await page.click('#type-toggle');
  await page.fill('#type-input', 'x');
  await page.press('#type-input', 'Enter');
  await page.waitForSelector('#confirm:not([hidden])');
  await page.locator('#type-form').evaluate((f) => ((f as HTMLElement).hidden = true));
  await page.locator('#heard').evaluate((h) => (h.textContent = '“Email Priya and ask about lunch tomorrow”'));
  await page.screenshot({ path: out('orb-confirm.png') });
});

test('demo frames', async ({ page }) => {
  await mockBridge(page, {
    responses: {
      'turn:Open mail': { ok: true, value: { conversationId: 'c1', reply: 'Opening Gmail.', actions: [], pendingConfirmation: null, services: ['gmail'] } },
      'turn:Brief me': {
        ok: true,
        value: {
          conversationId: 'c1',
          reply: "Good morning, Jahaan. You have 3 events left today. First up is Standup at 10 AM, in 25 minutes. You have 4 unread emails. Due today: Call mom.",
          actions: [],
          pendingConfirmation: null,
          services: ['calendar', 'gmail', 'tasks'],
        },
      },
    },
  });
  await page.setViewportSize({ width: 380, height: 460 });
  await page.goto('/orb.html');
  await page.evaluate(() => (document.body.style.background = 'linear-gradient(135deg,#1e293b,#0f172a)'));
  let n = 0;
  const shot = async (count: number, between = 90) => {
    for (let i = 0; i < count; i++) {
      await page.screenshot({ path: `../../docs/images/frames/f${String(n++).padStart(3, '0')}.png` });
      await page.waitForTimeout(between);
    }
  };
  const setMode = (mode: string, status: string) =>
    page.evaluate(([m, s]) => {
      document.body.dataset.mode = m;
      document.getElementById('status')!.textContent = s;
    }, [mode, status]);
  for (const command of ['Open mail', 'Brief me']) {
    await setMode('idle', 'Ready');
    await shot(6);
    await setMode('listening', 'Listening…');
    for (let i = 0; i < 14; i++) {
      await page.evaluate((v) => document.documentElement.style.setProperty('--level', String(v)), Math.abs(Math.sin(i * 0.9)) * 0.9);
      await shot(1, 60);
    }
    await page.evaluate(() => document.documentElement.style.setProperty('--level', '0'));
    await page.evaluate((c) => (document.getElementById('heard')!.textContent = `“${c}”`), command);
    await setMode('thinking', 'Thinking…');
    await shot(8);
    await page.evaluate((c) => window.aura.turn(c), command);
    await page.click('#type-toggle');
    await page.fill('#type-input', command);
    await page.press('#type-input', 'Enter');
    await page.locator('#type-form').evaluate((f) => ((f as HTMLElement).hidden = true));
    await shot(22);
    await page.evaluate(() => {
      document.getElementById('reply')!.textContent = '';
      document.getElementById('heard')!.textContent = '';
      ['#7C5CFF', '#22D3EE', '#F472B6', '#A78BFA'].forEach((c, i) => document.documentElement.style.setProperty(`--c${i + 1}`, c));
    });
  }
});
