import { describe, expect, it, vi } from 'vitest';
import { normalizeEmail } from '../src/identity/email.ts';
import {
  anyBreached,
  checkPasswordPolicy,
  hashPassword,
  localBreachedList,
  pwnedPasswordsChecker,
  TEST_ARGON2,
  verifyPassword,
} from '../src/identity/passwords.ts';
import { loginFailureDelayMs } from '../src/identity/rate-limit.ts';
import { hashToken, isWellFormedToken, issueToken } from '../src/identity/tokens.ts';

describe('passwords', () => {
  it('hashes with Argon2id and verifies', async () => {
    const stored = await hashPassword('correct horse battery', TEST_ARGON2);
    expect(stored).toMatch(/^\$argon2id\$v=19\$/);
    expect(await verifyPassword(stored, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(stored, 'wrong horse battery')).toBe(false);
  });

  it('the production defaults are Argon2id with 64 MiB', async () => {
    expect(await hashPassword('correct horse battery')).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  });

  it('treats a malformed stored hash as a failed check, not an exception', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('enforces length and the breached list', async () => {
    const list = localBreachedList();
    expect(await checkPasswordPolicy('short', list)).toBe('too_short');
    expect(await checkPasswordPolicy('x'.repeat(257), list)).toBe('too_long');
    expect(await checkPasswordPolicy('Password123', list)).toBe('breached');
    expect(await checkPasswordPolicy('qwertyuiop', list)).toBe('breached');
    expect(await checkPasswordPolicy('violet-tractor-91', list)).toBeUndefined();
  });

  it('k-anonymity checker sends only a 5-character SHA-1 prefix and matches the suffix', async () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n0000000000000000000000000000000000A:0\r\n'),
    );
    const checker = pwnedPasswordsChecker(fetchMock);
    expect(await checker.isBreached('password')).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    expect(await checker.isBreached('violet-tractor-91')).toBe(false);
  });

  it('k-anonymity checker fails open when the service is down', async () => {
    const checker = pwnedPasswordsChecker(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')));
    expect(await checker.isBreached('password')).toBe(false);
  });

  it('anyBreached combines checkers', async () => {
    const yes = { isBreached: () => Promise.resolve(true) };
    const no = { isBreached: () => Promise.resolve(false) };
    expect(await anyBreached(no, yes).isBreached('x')).toBe(true);
    expect(await anyBreached(no, no).isBreached('x')).toBe(false);
  });
});

describe('tokens', () => {
  it('are 32 random bytes, base64url, stored as SHA-256', () => {
    const a = issueToken();
    const b = issueToken();
    expect(a.token).not.toBe(b.token);
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32);
    expect(a.hash).toHaveLength(32);
    expect(a.hash.equals(hashToken(a.token))).toBe(true);
    expect(isWellFormedToken(a.token)).toBe(true);
    expect(isWellFormedToken(`${a.token}=`)).toBe(false);
    expect(isWellFormedToken("'; drop table users; --")).toBe(false);
  });
});

describe('normalizeEmail (docs/04 §1)', () => {
  it.each([
    ['  Asha.Rao+news@Example.IN ', 'asha.rao+news@example.in'],
    ['user@BÜCHER.example', 'user@xn--bcher-kva.example'],
    ['a@b.co', 'a@b.co'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each(['', 'no-at-sign', '@example.in', 'user@', 'user@localhost', 'a b@example.in', 'a@b@example.in', `${'x'.repeat(65)}@e.in`])(
    'rejects %j',
    (input) => {
      expect(normalizeEmail(input)).toBeUndefined();
    },
  );
});

describe('login failure delay', () => {
  it('grows progressively and is capped', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(loginFailureDelayMs)).toEqual([0, 0, 250, 500, 1000, 2000, 2000]);
  });
});
