import { expect, test } from '@playwright/test';
import { calls, mockBridge } from './mock-bridge';

test('signed out: offers Google sign-in', async ({ page }) => {
  await mockBridge(page, { signedIn: false });
  await page.goto('/dashboard.html');
  await expect(page.locator('#sign-in')).toBeVisible();
  await expect(page.locator('#pills')).toContainText('Signed out');
  await page.click('#sign-in');
  await expect.poll(async () => (await calls(page)).some(([name]) => name === 'signIn')).toBe(true);
});

test('signed in: shows the account, status and services', async ({ page }) => {
  await mockBridge(page);
  await page.goto('/dashboard.html');
  await expect(page.locator('.user')).toContainText('Jahaan Suthar');
  await expect(page.locator('.services')).toContainText('✓ Gmail');
  await expect(page.locator('#pills')).toContainText('AI: qwen3:8b');
  await expect(page.locator('#pills')).toContainText('Wake word: Computer');
});

test('runs an example and undoes from the activity list', async ({ page }) => {
  await mockBridge(page, {
    responses: {
      'turn:Brief me': {
        ok: true,
        value: { conversationId: 'c1', reply: "Good morning, Jahaan. It's Saturday, October 24.", actions: [], pendingConfirmation: null, services: ['calendar', 'gmail', 'tasks'] },
      },
      activity: {
        ok: true,
        value: {
          items: [
            { id: '11111111-1111-4111-8111-111111111111', tool: 'tasks_create', summary: 'Add the task "Buy milk"', status: 'SUCCEEDED', error: null, createdAt: new Date().toISOString(), undoable: true },
            { id: '22222222-2222-4222-8222-222222222222', tool: 'gmail_send', summary: 'Send an email to sam@example.com', status: 'SUCCEEDED', error: null, createdAt: new Date().toISOString(), undoable: false },
          ],
        },
      },
    },
  });
  await page.goto('/dashboard.html');
  await page.getByRole('button', { name: 'Brief me' }).click();
  await expect(page.locator('#answer-text')).toHaveText("Good morning, Jahaan. It's Saturday, October 24.");
  await expect(page.locator('.log li')).toHaveCount(2);
  await page.locator('.log li').first().getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#answer-text')).toHaveText('I removed Buy milk from your tasks.');
  await expect(page.locator('.log li').nth(1).getByRole('button', { name: 'Undo' })).toHaveCount(0);
});
