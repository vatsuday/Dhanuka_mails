// S2.2 invitations end to end over HTTP: invite → email in Mailpit → accept, with the role, email-match,
// expiry, revocation and audit rules.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, emailsTo, GOOD_PASSWORD, startStack, TERMS, tokenFrom, waitForEmail, type Stack } from './stack.ts';

let stack: Stack;
let owner: Client;
let tenantId: string;

let ip = 1;
/** Signs up and logs in; verifies the email unless told not to. */
async function user(email: string, verify = true): Promise<Client> {
  const client = new Client(stack.app, `198.51.100.${String(ip++)}`);
  await client.post('/auth/signup', { email, password: GOOD_PASSWORD, ...TERMS });
  if (verify) await client.post('/auth/verify-email', { token: tokenFrom((await waitForEmail(stack.mailpitUrl, email, 'Confirm')).text) });
  expect((await client.post('/auth/login', { email, password: GOOD_PASSWORD })).statusCode).toBe(200);
  return client;
}

async function invite(from: Client, email: string, role: string) {
  return from.post('/orgs/current/invitations', { email, role });
}

const inviteToken = async (email: string) => tokenFrom((await waitForEmail(stack.mailpitUrl, email, "You're invited")).text);

beforeAll(async () => {
  stack = await startStack();
  owner = await user('owner@invite.example.in');
  tenantId = (await owner.post('/orgs', { name: 'Invite Org' })).json<{ tenantId: string }>().tenantId;
});
afterAll(async () => {
  await stack.stop();
});

describe('invite and accept (AC 1, 2, 5, 6)', () => {
  it('the invitee gets an email in the sink, previews it, accepts, and becomes a member with that role', async () => {
    const response = await invite(owner, 'Marketer@Invite.Example.in', 'marketer');
    expect(response.statusCode).toBe(201);
    const email = await waitForEmail(stack.mailpitUrl, 'marketer@invite.example.in', "You're invited");
    expect(email.text).toContain('Invite Org');
    expect(email.text).toContain('as marketer');
    expect(email.text).toContain(`${'http://app.test'}/invite#token=`);
    const token = tokenFrom(email.text);

    const pending = (await owner.get('/orgs/current/invitations')).json<{ invitations: { email: string; role: string }[] }>();
    expect(pending.invitations).toMatchObject([{ email: 'marketer@invite.example.in', role: 'marketer' }]);

    const invitee = await user('marketer@invite.example.in');
    const preview = await invitee.post('/invitations/preview', { token });
    expect(preview.json()).toMatchObject({ tenantName: 'Invite Org', email: 'marketer@invite.example.in', role: 'marketer' });

    const accept = await invitee.post('/invitations/accept', { token });
    expect(accept.json()).toEqual({ tenantId });
    // The session switched into the organisation.
    expect((await invitee.get('/orgs/current')).json()).toMatchObject({ role: 'marketer', organisation: { name: 'Invite Org' } });

    // Single use, and no longer pending.
    expect((await invitee.post('/invitations/accept', { token })).statusCode).toBe(404);
    expect((await owner.get('/orgs/current/invitations')).json()).toEqual({ invitations: [] });
    const members = (await owner.get('/orgs/current/members')).json<{ members: { email: string; role: string }[] }>().members;
    expect(members.map((m) => [m.email, m.role])).toEqual([['owner@invite.example.in', 'owner'], ['marketer@invite.example.in', 'marketer']]);
  });

  it('records created, revoked and accepted in the tenant audit log (AC 5)', async () => {
    const { events } = (await owner.get('/orgs/current/audit-log')).json<{ events: { action: string }[] }>();
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['org.invitation_created', 'org.invitation_accepted']));
  });
});

describe('roles (AC 1)', () => {
  it('nobody can invite an owner; unknown roles are refused', async () => {
    expect((await invite(owner, 'x@invite.example.in', 'owner')).json()).toEqual({ error: 'role_not_allowed' });
    expect((await invite(owner, 'x@invite.example.in', 'superuser')).json()).toEqual({ error: 'role_not_allowed' });
  });

  it('an admin can invite admins and lower roles; a marketer cannot invite at all', async () => {
    await invite(owner, 'admin@invite.example.in', 'admin');
    const token = await inviteToken('admin@invite.example.in');
    const admin = await user('admin@invite.example.in');
    expect((await admin.post('/invitations/accept', { token })).statusCode).toBe(200);
    expect((await invite(admin, 'admin2@invite.example.in', 'admin')).statusCode).toBe(201);
    expect((await invite(admin, 'viewer@invite.example.in', 'viewer')).statusCode).toBe(201);
    expect((await invite(admin, 'owner2@invite.example.in', 'owner')).statusCode).toBe(403);

    const marketer = new Client(stack.app, '198.51.100.250');
    await marketer.post('/auth/login', { email: 'marketer@invite.example.in', password: GOOD_PASSWORD });
    await marketer.post('/orgs/select', { tenantId });
    expect((await invite(marketer, 'y@invite.example.in', 'viewer')).json()).toEqual({ error: 'forbidden' });
  });

  it('refuses to invite someone who is already a member', async () => {
    expect((await invite(owner, 'marketer@invite.example.in', 'viewer')).json()).toEqual({ error: 'already_member' });
  });
});

describe('who can accept (AC 3)', () => {
  it('only a signed-in user whose verified email matches', async () => {
    await invite(owner, 'dev@invite.example.in', 'developer');
    const token = await inviteToken('dev@invite.example.in');

    expect((await new Client(stack.app).post('/invitations/accept', { token })).statusCode).toBe(401);

    const someoneElse = await user('other@invite.example.in');
    expect((await someoneElse.post('/invitations/accept', { token })).json()).toEqual({ error: 'email_mismatch' });

    const unverified = await user('dev@invite.example.in', false);
    expect((await unverified.post('/invitations/accept', { token })).json()).toEqual({ error: 'email_not_verified' });
    await unverified.post('/auth/verify-email', { token: tokenFrom((await waitForEmail(stack.mailpitUrl, 'dev@invite.example.in', 'Confirm')).text) });
    expect((await unverified.post('/invitations/accept', { token })).statusCode).toBe(200);
  });

  it('malformed and unknown tokens look the same', async () => {
    const client = await user('nobody@invite.example.in');
    expect((await client.post('/invitations/preview', { token: 'short' })).json()).toEqual({ error: 'invalid_token' });
    expect((await client.post('/invitations/accept', { token: 'A'.repeat(43) })).json()).toEqual({ error: 'invalid_token' });
  });
});

describe('revocation, replacement and expiry (AC 2, 4)', () => {
  it('a revoked invitation can no longer be previewed or accepted', async () => {
    const created = (await invite(owner, 'revoked@invite.example.in', 'viewer')).json<{ invitationId: string }>();
    const token = await inviteToken('revoked@invite.example.in');
    expect((await owner.post(`/orgs/current/invitations/${created.invitationId}/revoke`)).statusCode).toBe(204);
    expect((await owner.post(`/orgs/current/invitations/${created.invitationId}/revoke`)).statusCode).toBe(404);
    const invitee = await user('revoked@invite.example.in');
    expect((await invitee.post('/invitations/preview', { token })).statusCode).toBe(404);
    expect((await invitee.post('/invitations/accept', { token })).json()).toEqual({ error: 'invalid_token' });
    const { events } = (await owner.get('/orgs/current/audit-log')).json<{ events: { action: string }[] }>();
    expect(events.map((e) => e.action)).toContain('org.invitation_revoked');
  });

  it('inviting the same address again replaces the earlier link', async () => {
    await invite(owner, 'again@invite.example.in', 'viewer');
    const first = await inviteToken('again@invite.example.in');
    await invite(owner, 'again@invite.example.in', 'developer');
    await expect.poll(async () => (await emailsTo(stack.mailpitUrl, 'again@invite.example.in')).length).toBe(2);
    const second = await inviteToken('again@invite.example.in');
    expect(second).not.toBe(first);
    const invitee = await user('again@invite.example.in');
    expect((await invitee.post('/invitations/accept', { token: first })).statusCode).toBe(404);
    expect((await invitee.post('/invitations/accept', { token: second })).statusCode).toBe(200);
    expect((await invitee.get('/orgs/current')).json()).toMatchObject({ role: 'developer' });
  });

  it('an expired invitation cannot be accepted, and expiry is 7 days', async () => {
    const created = (await invite(owner, 'late@invite.example.in', 'viewer')).json<{ invitationId: string }>();
    const token = await inviteToken('late@invite.example.in');
    const { rows } = await stack.pg.superuser.query<{ days: number }>(
      `select extract(epoch from expires_at - created_at) / 86400 as days from app.invitations where id = $1`, [created.invitationId],
    );
    expect(Number(rows[0]?.days)).toBeCloseTo(7, 2);
    await stack.pg.superuser.query(`update app.invitations set expires_at = now() - interval '1 second' where id = $1`, [created.invitationId]);
    const invitee = await user('late@invite.example.in');
    expect((await invitee.post('/invitations/accept', { token })).json()).toEqual({ error: 'invalid_token' });
  });

  it('stores only the SHA-256 of the token', async () => {
    await invite(owner, 'hash@invite.example.in', 'viewer');
    const token = await inviteToken('hash@invite.example.in');
    const { rows } = await stack.pg.superuser.query<{ token_hash: Buffer }>(`select token_hash from app.invitations where email_normalized = 'hash@invite.example.in'`);
    expect(rows[0]?.token_hash.length).toBe(32);
    expect(rows[0]?.token_hash.toString('base64url')).not.toBe(token);
  });
});
