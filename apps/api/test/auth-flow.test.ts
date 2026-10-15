// Sprint 1 identity flows end to end over HTTP: S1.1 sign-up and verification, S1.2 sessions,
// S1.3 password reset, S1.4 rate limits, S1.6 organisations, S1.9 audit events.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, Client, emailsTo, GOOD_PASSWORD, startStack, TERMS, tokenFrom, waitForEmail, type Stack } from './stack.ts';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await stack.stop();
});

const auditActions = async (email: string) =>
  (await stack.pg.superuser.query<{ action: string; ip: string | null; user_agent: string | null }>(
    `select a.action, host(a.ip) as ip, a.user_agent from app.audit_logs a
       join app.users u on u.id = a.actor_id where u.email_normalized = $1 order by a.created_at`,
    [email],
  )).rows;

async function signUpAndVerify(client: Client, email: string, password = GOOD_PASSWORD) {
  expect((await client.post('/auth/signup', { email, password, name: 'Test', ...TERMS })).statusCode).toBe(202);
  const mail = await waitForEmail(stack.mailpitUrl, email, 'Confirm your email');
  expect((await client.post('/auth/verify-email', { token: tokenFrom(mail.text) })).statusCode).toBe(200);
}

describe('S1.1 sign-up and email verification', () => {
  it('sign-up → email in Mailpit → verify → log in → create organisation (Sprint 1 exit demo)', async () => {
    const client = new Client(stack.app);
    const signup = await client.post('/auth/signup', { email: 'Asha@Example.in', password: GOOD_PASSWORD, name: 'Asha', ...TERMS });
    expect(signup.statusCode).toBe(202);
    expect(signup.json()).toEqual({ status: 'accepted' });

    const mail = await waitForEmail(stack.mailpitUrl, 'asha@example.in', 'Confirm your email');
    expect(mail.text).toContain(`${APP_URL}/verify-email#token=`);
    expect((await client.post('/auth/verify-email', { token: tokenFrom(mail.text) })).json()).toEqual({ status: 'verified' });

    const login = await client.post('/auth/login', { email: 'asha@example.in', password: GOOD_PASSWORD });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ user: { email: 'asha@example.in', name: 'Asha', emailVerified: true } });

    const org = await client.post('/orgs', { name: 'Asha Textiles' });
    expect(org.statusCode).toBe(201);
    const { tenantId, slug } = org.json<{ tenantId: string; slug: string }>();
    expect(slug).toBe('asha-textiles');

    const current = await client.get('/orgs/current');
    expect(current.json()).toEqual({
      role: 'owner',
      organisation: {
        id: tenantId, name: 'Asha Textiles', slug: 'asha-textiles', status: 'pending_review',
        currency: 'INR', timezone: 'Asia/Kolkata', locale: 'en-IN', dataRegion: 'ap-south-1',
      },
    });
    const { rows } = await stack.pg.superuser.query(`select tier, send_mode from app.tenant_sending_policies where tenant_id = $1`, [tenantId]);
    expect(rows).toEqual([{ tier: 'sandbox', send_mode: 'sandbox' }]);
    expect((await client.get('/me')).json()).toMatchObject({
      currentTenantId: tenantId,
      organisations: [{ tenantId, tenantName: 'Asha Textiles', role: 'owner', tenantStatus: 'pending_review' }],
    });
  });

  it('stores an Argon2id hash and the accepted terms and AUP versions', async () => {
    const { rows } = await stack.pg.superuser.query(
      `select password_hash, terms_version, aup_version, terms_accepted_at is not null as terms, aup_accepted_at is not null as aup
         from app.users where email_normalized = 'asha@example.in'`,
    );
    expect(rows[0]).toMatchObject({ terms_version: '2026-10-15', aup_version: '2026-10-15', terms: true, aup: true });
    expect((rows[0] as { password_hash: string }).password_hash).toMatch(/^\$argon2id\$/);
  });

  it('answers identically for an existing email, and mails the owner instead', async () => {
    const client = new Client(stack.app, '198.51.100.20');
    const again = await client.post('/auth/signup', { email: 'asha@example.in', password: 'another-good-pass-7', ...TERMS });
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual({ status: 'accepted' });
    await waitForEmail(stack.mailpitUrl, 'asha@example.in', 'You already have a Dhanuka Mails account');
    const { rows } = await stack.pg.superuser.query(`select count(*)::int as n from app.users where email_normalized = 'asha@example.in'`);
    expect(rows).toEqual([{ n: 1 }]);
  });

  it('rejects short and breached passwords and outdated terms', async () => {
    const client = new Client(stack.app, '198.51.100.21');
    expect((await client.post('/auth/signup', { email: 'x@example.in', password: 'short', ...TERMS })).json()).toEqual({ error: 'password_too_short' });
    expect((await client.post('/auth/signup', { email: 'x@example.in', password: 'Password123', ...TERMS })).json()).toEqual({ error: 'password_breached' });
    expect((await client.post('/auth/signup', { email: 'x@example.in', password: GOOD_PASSWORD, termsVersion: '2020-01-01', aupVersion: TERMS.aupVersion })).json())
      .toEqual({ error: 'outdated_terms' });
    expect((await client.post('/auth/signup', { email: 'not-an-email', password: GOOD_PASSWORD, ...TERMS })).json()).toEqual({ error: 'invalid_email' });
  });

  it('verification tokens are single use and expire after 24 hours; only a hash is stored', async () => {
    const client = new Client(stack.app, '198.51.100.22');
    await client.post('/auth/signup', { email: 'tok@example.in', password: GOOD_PASSWORD, ...TERMS });
    const token = tokenFrom((await waitForEmail(stack.mailpitUrl, 'tok@example.in', 'Confirm')).text);
    const stored = await stack.pg.superuser.query(
      `select encode(token_hash, 'hex') as h, extract(epoch from t.expires_at - t.created_at)::int as ttl from app.user_tokens t
         join app.users u on u.id = t.user_id where u.email_normalized = 'tok@example.in'`,
    );
    expect(stored.rows[0]).toMatchObject({ ttl: 86_400 });
    expect(JSON.stringify(stored.rows)).not.toContain(token);
    expect((await client.post('/auth/verify-email', { token })).statusCode).toBe(200);
    expect((await client.post('/auth/verify-email', { token })).json()).toEqual({ error: 'invalid_token' });

    await client.post('/auth/signup', { email: 'late@example.in', password: GOOD_PASSWORD, ...TERMS });
    const late = tokenFrom((await waitForEmail(stack.mailpitUrl, 'late@example.in', 'Confirm')).text);
    await stack.pg.superuser.query(`update app.user_tokens set expires_at = now() - interval '1 second'
      where user_id = (select id from app.users where email_normalized = 'late@example.in')`);
    expect((await client.post('/auth/verify-email', { token: late })).json()).toEqual({ error: 'invalid_token' });
  });

  it('a resent verification email invalidates the earlier link', async () => {
    const client = new Client(stack.app, '198.51.100.23');
    await client.post('/auth/signup', { email: 'resend@example.in', password: GOOD_PASSWORD, ...TERMS });
    const first = tokenFrom((await waitForEmail(stack.mailpitUrl, 'resend@example.in', 'Confirm')).text);
    expect((await client.post('/auth/resend-verification', { email: 'resend@example.in' })).statusCode).toBe(202);
    await expect.poll(async () => (await emailsTo(stack.mailpitUrl, 'resend@example.in')).length).toBe(2);
    expect((await client.post('/auth/verify-email', { token: first })).statusCode).toBe(400);
    const second = tokenFrom((await waitForEmail(stack.mailpitUrl, 'resend@example.in', 'Confirm')).text);
    expect((await client.post('/auth/verify-email', { token: second })).statusCode).toBe(200);
  });

  it('unverified users cannot create an organisation (AC 6)', async () => {
    const client = new Client(stack.app, '198.51.100.24');
    await client.post('/auth/signup', { email: 'unverified@example.in', password: GOOD_PASSWORD, ...TERMS });
    expect((await client.post('/auth/login', { email: 'unverified@example.in', password: GOOD_PASSWORD })).statusCode).toBe(200);
    const org = await client.post('/orgs', { name: 'Too Early' });
    expect(org.statusCode).toBe(403);
    expect(org.json()).toEqual({ error: 'email_not_verified' });
  });
});

describe('S1.2 sessions', () => {
  it('sets a __Host- cookie that is HttpOnly, Secure and SameSite=Lax', async () => {
    const client = new Client(stack.app, '198.51.100.30');
    await signUpAndVerify(client, 'cookie@example.in');
    const login = await client.post('/auth/login', { email: 'cookie@example.in', password: GOOD_PASSWORD });
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/^__Host-dm_session=[A-Za-z0-9_-]{43}; /);
    for (const attribute of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) expect(cookie).toContain(attribute);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('rotates the session ID on login and on switching organisation', async () => {
    const client = new Client(stack.app, '198.51.100.31');
    await signUpAndVerify(client, 'rotate@example.in');
    await client.post('/auth/login', { email: 'rotate@example.in', password: GOOD_PASSWORD });
    const first = client.cookie;
    await client.post('/auth/login', { email: 'rotate@example.in', password: GOOD_PASSWORD });
    expect(client.cookie).not.toBe(first);
    expect((await client.get('/me', { cookie: first ?? '' })).statusCode).toBe(401);
    const beforeOrg = client.cookie;
    await client.post('/orgs', { name: 'Rotate Co' });
    expect(client.cookie).not.toBe(beforeOrg);
    expect((await client.get('/me', { cookie: beforeOrg ?? '' })).statusCode).toBe(401);
  });

  it('logout deletes the server-side session', async () => {
    const client = new Client(stack.app, '198.51.100.32');
    await signUpAndVerify(client, 'logout@example.in');
    await client.post('/auth/login', { email: 'logout@example.in', password: GOOD_PASSWORD });
    const cookie = client.cookie ?? '';
    expect((await client.post('/auth/logout')).statusCode).toBe(204);
    expect((await client.get('/me', { cookie })).statusCode).toBe(401);
  });

  it('rejects state-changing requests without our Origin (AC 5)', async () => {
    const client = new Client(stack.app, '198.51.100.33');
    await signUpAndVerify(client, 'csrf@example.in');
    await client.post('/auth/login', { email: 'csrf@example.in', password: GOOD_PASSWORD });
    const noOrigin = await stack.app.inject({ method: 'POST', url: '/orgs', payload: { name: 'X' }, headers: { cookie: client.cookie ?? '' } });
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.json()).toEqual({ error: 'bad_origin' });
    expect((await client.post('/orgs', { name: 'X' }, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await client.post('/orgs', { name: 'X' }, { origin: 'http://app.test.evil.example' })).statusCode).toBe(403);
    // A matching Referer is accepted when Origin is absent.
    const viaReferer = await stack.app.inject({
      method: 'POST', url: '/orgs', payload: { name: 'Via Referer' }, headers: { cookie: client.cookie ?? '', referer: `${APP_URL}/orgs/new` },
    });
    expect(viaReferer.statusCode).toBe(201);
    // Login is protected too (login CSRF).
    expect((await stack.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a', password: 'b' } })).statusCode).toBe(403);
  });
});

describe('S1.3 password reset', () => {
  it('same response for unknown accounts; reset email; new password works; all sessions revoked', async () => {
    const browser1 = new Client(stack.app, '198.51.100.40');
    const browser2 = new Client(stack.app, '198.51.100.41');
    await signUpAndVerify(browser1, 'reset@example.in');
    await browser1.post('/auth/login', { email: 'reset@example.in', password: GOOD_PASSWORD });
    await browser2.post('/auth/login', { email: 'reset@example.in', password: GOOD_PASSWORD });

    const unknown = await browser1.post('/auth/password-reset/request', { email: 'nobody@example.in' });
    const known = await browser1.post('/auth/password-reset/request', { email: 'reset@example.in' });
    expect([unknown.statusCode, unknown.json()]).toEqual([known.statusCode, known.json()]);
    expect(await emailsTo(stack.mailpitUrl, 'nobody@example.in')).toEqual([]);

    const mail = await waitForEmail(stack.mailpitUrl, 'reset@example.in', 'Reset your password');
    const token = tokenFrom(mail.text);
    const ttl = await stack.pg.superuser.query(`select extract(epoch from expires_at - created_at)::int as ttl from app.user_tokens where purpose = 'reset_password' and used_at is null`);
    expect(ttl.rows).toEqual([{ ttl: 3600 }]);

    expect((await browser1.post('/auth/password-reset/confirm', { token, password: 'Password123' })).json()).toEqual({ error: 'password_breached' });
    expect((await browser1.post('/auth/password-reset/confirm', { token, password: 'brand-new-secret-42' })).statusCode).toBe(200);
    expect((await browser1.post('/auth/password-reset/confirm', { token, password: 'another-secret-43' })).json()).toEqual({ error: 'invalid_token' });

    expect((await browser2.get('/me')).statusCode).toBe(401);
    expect((await browser1.post('/auth/login', { email: 'reset@example.in', password: GOOD_PASSWORD })).statusCode).toBe(401);
    expect((await browser1.post('/auth/login', { email: 'reset@example.in', password: 'brand-new-secret-42' })).statusCode).toBe(200);
  });
});

describe('S1.4 rate limits', () => {
  it('login: 5 attempts per minute per account and IP, then 429 with Retry-After', async () => {
    const client = new Client(stack.app, '198.51.100.50');
    await signUpAndVerify(client, 'limit@example.in');
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await client.post('/auth/login', { email: 'limit@example.in', password: 'wrong-password-x' })).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    const limited = await client.post('/auth/login', { email: 'limit@example.in', password: GOOD_PASSWORD });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    // Another IP is not affected.
    expect((await new Client(stack.app, '198.51.100.51').post('/auth/login', { email: 'limit@example.in', password: GOOD_PASSWORD })).statusCode).toBe(200);
  });

  it('password reset and verification resend: 3 per hour per email', async () => {
    const client = new Client(stack.app, '198.51.100.52');
    const reset = [];
    const resend = [];
    for (let i = 0; i < 4; i++) {
      reset.push((await client.post('/auth/password-reset/request', { email: 'flood@example.in' })).statusCode);
      resend.push((await client.post('/auth/resend-verification', { email: 'flood@example.in' })).statusCode);
    }
    expect(reset).toEqual([202, 202, 202, 429]);
    expect(resend).toEqual([202, 202, 202, 429]);
  });

  it('limits live in valkey-cache under hashed keys', async () => {
    const keys = await stack.cache.keys('rl:*');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.includes('@'))).toBe(false);
  });
});

describe('S1.9 audit events', () => {
  it('records sign-up, verification, login success and failure, reset and organisation creation with IP and user agent', async () => {
    const client = new Client(stack.app, '203.0.113.99');
    await signUpAndVerify(client, 'audited@example.in');
    await client.post('/auth/login', { email: 'audited@example.in', password: 'wrong-password-y' }, { 'user-agent': 'AuditTest/1.0' });
    await client.post('/auth/login', { email: 'audited@example.in', password: GOOD_PASSWORD }, { 'user-agent': 'AuditTest/1.0' });
    await client.post('/orgs', { name: 'Audited Org' });
    await client.post('/auth/password-reset/request', { email: 'audited@example.in' });
    const token = tokenFrom((await waitForEmail(stack.mailpitUrl, 'audited@example.in', 'Reset')).text);
    await client.post('/auth/password-reset/confirm', { token, password: 'audited-new-pass-1' });

    const events = await auditActions('audited@example.in');
    expect(events.map((e) => e.action)).toEqual([
      'auth.signup', 'auth.email_verified', 'auth.login_failed', 'auth.login_succeeded',
      'org.created', 'auth.password_reset_requested', 'auth.password_reset',
    ]);
    expect(events.every((e) => e.ip === '203.0.113.99')).toBe(true);
    expect(events.find((e) => e.action === 'auth.login_failed')?.user_agent).toBe('AuditTest/1.0');
  });
});
