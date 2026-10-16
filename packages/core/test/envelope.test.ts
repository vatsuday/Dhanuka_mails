// S2.1 AC 2: envelope encryption of MFA secrets.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, localKek } from '../src/crypto/envelope.ts';

const secret = Buffer.from('JBSWY3DPEHPK3PXP');

describe('envelope encryption', () => {
  it('round-trips and never stores the plaintext', async () => {
    const kek = localKek('k1', randomBytes(32));
    const value = await encrypt(kek, secret, 'mfa:user-1');
    expect(value.keyId).toBe('k1');
    expect(value.ciphertext.includes(secret)).toBe(false);
    expect(await decrypt([kek], value, 'mfa:user-1')).toEqual(secret);
  });

  it('uses a fresh data key and IV each time', async () => {
    const kek = localKek('k1', randomBytes(32));
    const a = await encrypt(kek, secret, 'ctx');
    const b = await encrypt(kek, secret, 'ctx');
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('binds the context, so a ciphertext copied to another user fails', async () => {
    const kek = localKek('k1', randomBytes(32));
    const value = await encrypt(kek, secret, 'mfa:user-1');
    await expect(decrypt([kek], value, 'mfa:user-2')).rejects.toThrow();
  });

  it('detects tampering', async () => {
    const kek = localKek('k1', randomBytes(32));
    const value = await encrypt(kek, secret, 'ctx');
    const tampered = Buffer.from(value.ciphertext);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    await expect(decrypt([kek], { ...value, ciphertext: tampered }, 'ctx')).rejects.toThrow();
  });

  it('decrypts with an older KEK after rotation and rejects an unknown key id', async () => {
    const old = localKek('k1', randomBytes(32));
    const current = localKek('k2', randomBytes(32));
    const value = await encrypt(old, secret, 'ctx');
    expect(await decrypt([current, old], value, 'ctx')).toEqual(secret);
    await expect(decrypt([current], value, 'ctx')).rejects.toThrow(/no key-encryption key with id k1/);
  });

  it('a different KEK with the same id cannot unwrap', async () => {
    const value = await encrypt(localKek('k1', randomBytes(32)), secret, 'ctx');
    await expect(decrypt([localKek('k1', randomBytes(32))], value, 'ctx')).rejects.toThrow();
  });

  it('rejects a local KEK that is not 32 bytes', () => {
    expect(() => localKek('k', randomBytes(16))).toThrow(/32 bytes/);
  });
});
