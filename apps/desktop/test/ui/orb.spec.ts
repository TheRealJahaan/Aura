import { expect, test } from '@playwright/test';
import { calls, mockBridge } from './mock-bridge';

const pending = {
  conversationId: 'c1',
  reply: 'I\'m about to send an email to priya@example.com with the subject "Lunch". Should I go ahead?',
  actions: [],
  pendingConfirmation: {
    actionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    summary: 'Send an email to priya@example.com with the subject "Lunch"',
    details: [
      { label: 'To', value: 'priya@example.com' },
      { label: 'Subject', value: 'Lunch' },
      { label: 'Message', value: '<img src=x onerror=alert(1)> Lunch at 1?' },
    ],
  },
  services: ['contacts', 'gmail'],
};

test('shows the hint for the wake word and hotkey', async ({ page }) => {
  await mockBridge(page);
  await page.goto('/orb.html');
  await expect(page.locator('#hint')).toHaveText(/Say “Computer” or press/);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'idle');
});

test('typed command shows the reply, tints the orb and speaks', async ({ page }) => {
  await mockBridge(page, {
    responses: {
      'turn:open mail': { ok: true, value: { conversationId: 'c1', reply: 'Opening Gmail.', actions: [], pendingConfirmation: null, services: ['gmail'] } },
    },
  });
  await page.goto('/orb.html');
  await page.click('#type-toggle');
  await page.fill('#type-input', 'open mail');
  await page.press('#type-input', 'Enter');
  await expect(page.locator('#reply')).toHaveText('Opening Gmail.');
  await expect(page.locator('#heard')).toHaveText('“open mail”');
  const c1 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--c1').trim());
  expect(c1.toLowerCase()).toBe('#ea4335');
  expect((await calls(page)).some(([name, args]) => name === 'speak' && args[0] === 'Opening Gmail.')).toBe(true);
});

test('asks before sending and shows details as plain text', async ({ page }) => {
  await mockBridge(page, { responses: { 'turn:email priya about lunch': { ok: true, value: pending } } });
  await page.goto('/orb.html');
  page.on('dialog', () => {
    throw new Error('An email body must never run code');
  });
  await page.click('#type-toggle');
  await page.fill('#type-input', 'email priya about lunch');
  await page.press('#type-input', 'Enter');
  await expect(page.locator('#confirm')).toBeVisible();
  await expect(page.locator('#confirm-title')).toHaveText('Send an email to priya@example.com with the subject "Lunch"?');
  await expect(page.locator('#confirm-details dd').nth(2)).toHaveText('<img src=x onerror=alert(1)> Lunch at 1?');
  await page.click('#approve');
  await expect(page.locator('#reply')).toHaveText('Sent. Your email to priya@example.com is on its way.');
  await expect(page.locator('#confirm')).toBeHidden();
  expect((await calls(page)).find(([name]) => name === 'confirm')?.[1]).toEqual([pending.pendingConfirmation.actionId, true]);
});

test('Escape cancels a pending action', async ({ page }) => {
  await mockBridge(page, { responses: { 'turn:email priya about lunch': { ok: true, value: pending } } });
  await page.goto('/orb.html');
  await page.click('#type-toggle');
  await page.fill('#type-input', 'email priya about lunch');
  await page.press('#type-input', 'Enter');
  await expect(page.locator('#confirm')).toBeVisible();
  await page.locator('#reply').click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await calls(page)).find(([name]) => name === 'confirm')?.[1]).toEqual([
    pending.pendingConfirmation.actionId,
    false,
  ]);
});

test('errors are shown and spoken', async ({ page }) => {
  await mockBridge(page, { responses: { 'turn:brief me': { ok: false, error: "I can't reach the Aura server at http://127.0.0.1:3000. Start it with: npm run api" } } });
  await page.goto('/orb.html');
  await page.click('#type-toggle');
  await page.fill('#type-input', 'brief me');
  await page.press('#type-input', 'Enter');
  await expect(page.locator('#reply')).toContainText("can't reach the Aura server");
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'error');
});
