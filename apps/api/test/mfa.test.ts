// S2.1 TOTP MFA end to end over HTTP, with the TOTP clock pinned so time windows are exact.
import { generate } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, GOOD_PASSWORD, startStack, TERMS, tokenFrom, waitForEmail, type Stack } from './stack.ts';

let stack: Stack;
let now = 1_900_000_020; // aligned to a 30 s step boundary + 20 s
const code = (secret: string, at = now) => generate({ secret, epoch: at });

beforeAll(async () => {
  stack = await startStack({ nowSeconds: () => now });
});
afterAll(async () => {
  await stack.stop();
});

let ip = 1;
async function verifiedUser(email: string): Promise<Client> {
  const client = new Client(stack.app, `203.0.113.${String(ip++)}`);
  await client.post('/auth/signup', { email, password: GOOD_PASSWORD, ...TERMS });
  await client.post('/auth/verify-email', { token: tokenFrom((await waitForEmail(stack.mailpitUrl, email, 'Confirm')).text) });
  expect((await client.post('/auth/login', { email, password: GOOD_PASSWORD })).statusCode).toBe(200);
  return client;
}

/** Enrols and confirms MFA; returns the secret and the recovery codes. */
async function enableMfa(client: Client): Promise<{ secret: string; recoveryCodes: string[] }> {
  const { secret } = (await client.post('/auth/mfa/enroll')).json<{ secret: string }>();
  const confirm = await client.post('/auth/mfa/confirm', { code: await code(secret) });
  expect(confirm.statusCode).toBe(200);
  now += 30; // move to the next step so later tests don't reuse the confirmation step
  return { secret, recoveryCodes: confirm.json<{ recoveryCodes: string[] }>().recoveryCodes };
}

async function login(client: Client, email: string, password = GOOD_PASSWORD) {
  return (await client.post('/auth/login', { email, password })).json<{ mfaRequired?: boolean; challengeId?: string }>();
}

describe('enrolment (AC 1–3)', () => {
  it('returns a QR code and otpauth URI; MFA is inactive until a code confirms it', async () => {
    const client = await verifiedUser('enrol@mfa.example.in');
    const enrol = await client.post('/auth/mfa/enroll');
    expect(enrol.statusCode).toBe(200);
    const body = enrol.json<{ secret: string; otpauthUri: string; qrCode: string }>();
    expect(body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Dhanuka%20Mails:enrol%40mfa\.example\.in\?secret=[A-Z2-7]+/);
    expect(body.qrCode).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(body.qrCode.split(',')[1] ?? '', 'base64').toString()).toContain('<svg');
    expect((await client.get('/auth/mfa')).json()).toEqual({ enabled: false, recoveryCodesRemaining: 0 });

    expect((await client.post('/auth/mfa/confirm', { code: '000000' })).json()).toEqual({ error: 'invalid_code' });
    const confirm = await client.post('/auth/mfa/confirm', { code: await code(body.secret) });
    const { recoveryCodes } = confirm.json<{ recoveryCodes: string[] }>();
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const c of recoveryCodes) expect(c).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}$/);
    expect((await client.get('/auth/mfa')).json()).toEqual({ enabled: true, recoveryCodesRemaining: 10 });
    expect((await client.post('/auth/mfa/enroll')).json()).toEqual({ error: 'already_enabled' });
    now += 30;
  });

  it('stores the secret envelope-encrypted and the recovery codes only as hashes (AC 2, 3)', async () => {
    const client = await verifiedUser('stored@mfa.example.in');
    const { secret, recoveryCodes } = await enableMfa(client);
    const { rows } = await stack.pg.superuser.query<{ secret_ciphertext: Buffer; key_id: string; codes: Buffer[] }>(
      `select f.secret_ciphertext, f.key_id, f.recovery_codes_hashed as codes from app.mfa_factors f
         join app.users u on u.id = f.user_id where u.email_normalized = 'stored@mfa.example.in'`,
    );
    const row = rows[0];
    expect(row?.key_id).toBe('test-1');
    expect(row?.secret_ciphertext.includes(Buffer.from(secret))).toBe(false);
    expect(row?.codes).toHaveLength(10);
    expect(row?.codes.every((h) => h.length === 32)).toBe(true);
    const dump = JSON.stringify(rows);
    for (const c of recoveryCodes) expect(dump).not.toContain(c.replace('-', ''));
  });
});

describe('login with MFA (AC 4, 6)', () => {
  let client: Client;
  let secret: string;
  let recoveryCodes: string[];
  const email = 'login@mfa.example.in';

  beforeAll(async () => {
    client = await verifiedUser(email);
    ({ secret, recoveryCodes } = await enableMfa(client));
  });

  it('the password alone gives no session, only a challenge', async () => {
    const fresh = new Client(stack.app, '203.0.113.200');
    const login = await fresh.post('/auth/login', { email, password: GOOD_PASSWORD });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ mfaRequired: true, challengeId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as string });
    expect(login.headers['set-cookie']).toBeUndefined();
    expect((await fresh.get('/me')).statusCode).toBe(401);
  });

  it('a valid code completes the login and records it with mfa: true', async () => {
    const fresh = new Client(stack.app, '203.0.113.201');
    const { challengeId } = await login(fresh, email);
    const done = await fresh.post('/auth/login/mfa', { challengeId, code: await code(secret) });
    expect(done.statusCode).toBe(200);
    expect(String(done.headers['set-cookie'])).toMatch(/^__Host-dm_session=/);
    expect((await fresh.get('/me')).json()).toMatchObject({ user: { email, mfaEnabled: true } });
    const { rows } = await stack.pg.superuser.query(
      `select metadata from app.audit_logs a join app.users u on u.id = a.actor_id
        where u.email_normalized = $1 and a.action = 'auth.login_succeeded' order by a.created_at desc limit 1`,
      [email],
    );
    expect(rows).toEqual([{ metadata: { mfa: true } }]);
  });

  it('rejects a code reused within its window (AC 4)', async () => {
    now += 30;
    const fresh = new Client(stack.app, '203.0.113.202');
    const current = await code(secret);
    const first = await login(fresh, email);
    expect((await fresh.post('/auth/login/mfa', { challengeId: first.challengeId, code: current })).statusCode).toBe(200);
    const second = await login(fresh, email);
    expect((await fresh.post('/auth/login/mfa', { challengeId: second.challengeId, code: current })).json()).toEqual({ error: 'invalid_code' });
  });

  it('accepts a code one step old or one step ahead, but not two (AC 4)', async () => {
    now += 120;
    const fresh = new Client(stack.app, '203.0.113.203');
    let { challengeId } = await login(fresh, email);
    expect((await fresh.post('/auth/login/mfa', { challengeId, code: await code(secret, now - 60) })).statusCode).toBe(401);
    expect((await fresh.post('/auth/login/mfa', { challengeId, code: await code(secret, now - 30) })).statusCode).toBe(200);
    now += 120;
    ({ challengeId } = await login(fresh, email));
    expect((await fresh.post('/auth/login/mfa', { challengeId, code: await code(secret, now + 60) })).statusCode).toBe(401);
    expect((await fresh.post('/auth/login/mfa', { challengeId, code: await code(secret, now + 30) })).statusCode).toBe(200);
  });

  it('a recovery code works once (AC 3)', async () => {
    now += 120;
    const recovery = recoveryCodes[0] ?? '';
    const fresh = new Client(stack.app, '203.0.113.204');
    let { challengeId } = await login(fresh, email);
    expect((await fresh.post('/auth/login/mfa', { challengeId, code: recovery.toLowerCase() })).statusCode).toBe(200);
    ({ challengeId } = await login(fresh, email));
    expect((await fresh.post('/auth/login/mfa', { challengeId, code: recovery })).json()).toEqual({ error: 'invalid_code' });
    expect((await fresh.get('/auth/mfa')).json()).toMatchObject({ recoveryCodesRemaining: 9 });
  });

  it('a challenge dies after 5 wrong codes', async () => {
    const fresh = new Client(stack.app, '203.0.113.205');
    const { challengeId } = await login(fresh, email);
    for (let i = 0; i < 5; i++) await fresh.post('/auth/login/mfa', { challengeId, code: '111111' });
    expect((await fresh.post('/auth/login/mfa', { challengeId, code: await code(secret) })).json()).toEqual({ error: 'invalid_challenge' });
  });

  it('turning MFA off needs a valid code', async () => {
    now += 120;
    const fresh = new Client(stack.app, '203.0.113.206');
    const { challengeId } = await login(fresh, email);
    await fresh.post('/auth/login/mfa', { challengeId, code: recoveryCodes[1] ?? '' });
    expect((await fresh.post('/auth/mfa/disable', { code: '123456' })).statusCode).toBe(400);
    expect((await fresh.post('/auth/mfa/disable', { code: await code(secret) })).statusCode).toBe(204);
    expect((await login(new Client(stack.app, '203.0.113.207'), email)).mfaRequired).toBeUndefined();
  });
});

describe('organisation requires MFA (AC 5)', () => {
  it('owner must have MFA to require it; members without MFA are then locked out until they enable it', async () => {
    const owner = await verifiedUser('owner@mfa.example.in');
    const tenantId = (await owner.post('/orgs', { name: 'Secure Co' })).json<{ tenantId: string }>().tenantId;
    expect((await owner.post('/orgs/current/security', { requireMfa: true })).json()).toEqual({ error: 'enable_mfa_first' });

    const member = await verifiedUser('member@mfa.example.in');
    await stack.pg.superuser.query(
      `insert into app.memberships (tenant_id, user_id, role) select $1, id, 'marketer' from app.users where email_normalized = 'member@mfa.example.in'`,
      [tenantId],
    );
    await member.post('/orgs/select', { tenantId });
    expect((await member.get('/orgs/current')).statusCode).toBe(200);

    await enableMfa(owner);
    expect((await owner.post('/orgs/current/security', { requireMfa: true })).json()).toEqual({ requireMfa: true });
    expect((await owner.get('/orgs/current')).json()).toMatchObject({ organisation: { requireMfa: true } });

    const blocked = await member.get('/orgs/current');
    expect([blocked.statusCode, blocked.json()]).toEqual([403, { error: 'mfa_required' }]);
    await enableMfa(member);
    expect((await member.get('/orgs/current')).statusCode).toBe(200);

    const { rows } = await stack.pg.superuser.query(`select metadata from app.audit_logs where tenant_id = $1 and action = 'org.mfa_requirement_changed'`, [tenantId]);
    expect(rows).toEqual([{ metadata: { required: true } }]);
  });
});
