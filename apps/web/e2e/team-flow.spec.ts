// Sprint 2 in a real browser (S2.1, S2.2): the owner turns on two-step verification and logs in with a
// code, invites a marketer from the dashboard, and the invitee signs up from the email link and joins.
// Needs the whole local stack, like signup-flow.spec.ts, so it runs only with E2E_STACK=1.
import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
const PASSWORD = 'violet-tractor-91';

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

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), standing in for the user's authenticator app. */
function totp(base32Secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of base32Secret.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function signUpAndConfirm(page: Page, name: string, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel(/I accept the Terms of Service/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await linkFromEmail(email, 'Confirm your email'));
  await expect(page.getByRole('status')).toHaveText('Your email address is confirmed.');
}

async function logIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('owner enables two-step login, invites a marketer, and the marketer joins', async ({ browser }) => {
  const id = randomUUID().slice(0, 8);
  const ownerEmail = `owner-${id}@example.in`;
  const marketerEmail = `marketer-${id}@example.in`;

  // Owner: sign up, create the organisation.
  const owner = await (await browser.newContext()).newPage();
  await signUpAndConfirm(owner, 'Ravi', ownerEmail);
  await logIn(owner, ownerEmail);
  await owner.getByLabel('Organisation name').fill(`Ravi Spices ${id}`);
  await owner.getByRole('button', { name: 'Create organisation' }).click();
  await expect(owner.getByRole('heading', { name: `Ravi Spices ${id}` })).toBeVisible();

  // S2.1: set up two-step verification from the QR card, keep the recovery codes.
  await owner.getByRole('button', { name: 'Set up two-step verification' }).click();
  await expect(owner.getByAltText('QR code for your authenticator app')).toBeVisible();
  const secret = (await owner.locator('code').textContent()) ?? '';
  await owner.getByLabel('Code', { exact: true }).fill(totp(secret));
  await owner.getByRole('button', { name: 'Turn on' }).click();
  await expect(owner.getByText('Two-step verification is on.')).toBeVisible();
  const recoveryCodes = ((await owner.locator('pre.codes').textContent()) ?? '').split('\n');
  expect(recoveryCodes).toHaveLength(10);

  // Log out and back in: the password alone is not enough; a recovery code works (the TOTP step was just used).
  await owner.getByRole('button', { name: 'Log out' }).click();
  await logIn(owner, ownerEmail);
  await expect(owner.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await owner.getByLabel('Code').fill('000000');
  await owner.getByRole('button', { name: 'Verify' }).click();
  await expect(owner.getByText('That code is not valid')).toBeVisible();
  await owner.getByLabel('Code').fill(recoveryCodes[0] ?? '');
  await owner.getByRole('button', { name: 'Verify' }).click();
  await expect(owner.getByRole('heading', { name: 'Hello, Ravi' })).toBeVisible();

  // A new session starts with no organisation selected.
  await owner.getByRole('button', { name: 'Switch' }).click();
  await expect(owner.getByRole('heading', { name: `Ravi Spices ${id}` })).toBeVisible();

  // S2.2: invite a marketer from the members card.
  await owner.getByLabel('Email').fill(marketerEmail);
  await owner.getByLabel('Role').selectOption('marketer');
  await owner.getByRole('button', { name: 'Send invitation' }).click();
  await expect(owner.getByText(`Invitation sent to ${marketerEmail}.`)).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Pending invitations' })).toBeVisible();

  // Invitee: opens the link signed out, signs up in the same tab, logs in and is brought back to accept.
  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(await linkFromEmail(marketerEmail, "You're invited"));
  await expect(invitee.getByText('Log in, or create an account')).toBeVisible();
  await signUpAndConfirm(invitee, 'Meera', marketerEmail);
  await logIn(invitee, marketerEmail);
  await expect(invitee).toHaveURL(/\/invite$/);
  await expect(invitee.getByText(`Ravi Spices ${id}`)).toBeVisible();
  await invitee.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(invitee.getByRole('heading', { name: `Ravi Spices ${id}` })).toBeVisible();
  await expect(invitee.getByText('marketer', { exact: true }).first()).toBeVisible();
  // Marketers see the members but cannot invite.
  await expect(invitee.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);

  // The owner now sees both members and no pending invitation.
  await owner.reload();
  await expect(owner.getByText(marketerEmail)).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Pending invitations' })).toHaveCount(0);
});
