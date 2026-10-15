// Sprint 1 exit demo in a real browser: sign up → confirm via the email in Mailpit → log in →
// create an organisation. Needs the whole local stack (pnpm infra:up, db:migrate, the api on :3001),
// so it runs only with E2E_STACK=1. The CI e2e job covers the web app alone until staging exists.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';

test.skip(process.env.E2E_STACK !== '1', 'needs the local stack: set E2E_STACK=1');

async function linkFromEmail(to: string, subject: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()) as {
      messages: { ID: string; Subject: string }[];
    };
    const match = search.messages.find((m) => m.Subject.includes(subject));
    if (match !== undefined) {
      const { Text } = (await (await fetch(`${MAILPIT}/api/v1/message/${match.ID}`)).json()) as { Text: string };
      const link = /(https?:\/\/\S+#token=[A-Za-z0-9_-]{43})/.exec(Text)?.[1];
      if (link !== undefined) return link;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no "${subject}" email for ${to}`);
}

test('sign up, confirm the email from Mailpit, log in and create an organisation', async ({ page }) => {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.in`;
  const password = 'violet-tractor-91';

  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Priya');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByLabel(/I accept the Terms of Service/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(await linkFromEmail(email, 'Confirm your email'));
  await expect(page.getByRole('status')).toHaveText('Your email address is confirmed.');

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Priya' })).toBeVisible();

  await page.getByLabel('Organisation name').fill('Priya Handlooms');
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page.getByRole('heading', { name: 'Priya Handlooms' })).toBeVisible();
  await expect(page.getByText('owner', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('pending review')).toBeVisible();

  // The session cookie is first-party, HttpOnly and __Host- prefixed.
  const cookie = (await page.context().cookies()).find((c) => c.name === '__Host-dm_session');
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
