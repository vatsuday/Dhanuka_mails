// Envelope encryption (docs/02 §5, §11; S2.1 AC 2). Each value gets a fresh 256-bit data key; the data
// key is wrapped by a key-encryption key (KEK). Locally the KEK comes from the environment; in AWS it is
// a KMS key behind the same interface. Ciphertexts record which KEK wrapped them (`keyId`) for rotation.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface KeyEncryptionKey {
  readonly keyId: string;
  wrap: (dataKey: Buffer) => Promise<Buffer>;
  unwrap: (wrapped: Buffer) => Promise<Buffer>;
}

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function open(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/** A KEK held in process memory: development, CI and tests only. */
export function localKek(keyId: string, key: Buffer): KeyEncryptionKey {
  if (key.length !== 32) throw new Error('local KEK must be 32 bytes');
  const aad = Buffer.from(`kek:${keyId}`);
  return {
    keyId,
    wrap: (dataKey) => Promise.resolve(seal(key, dataKey, aad)),
    unwrap: (wrapped) => Promise.resolve(open(key, wrapped, aad)),
  };
}

export interface Encrypted {
  ciphertext: Buffer;
  keyId: string;
}

/**
 * Layout: version (1) | wrapped-key length (2, BE) | wrapped key | iv (12) | tag (16) | body.
 * `context` is bound as AAD (e.g. `mfa:<userId>`), so a ciphertext copied to another row fails to decrypt.
 */
export async function encrypt(kek: KeyEncryptionKey, plaintext: Buffer, context: string): Promise<Encrypted> {
  const dataKey = randomBytes(32);
  try {
    const wrapped = await kek.wrap(dataKey);
    const header = Buffer.alloc(3);
    header.writeUInt8(VERSION, 0);
    header.writeUInt16BE(wrapped.length, 1);
    return { ciphertext: Buffer.concat([header, wrapped, seal(dataKey, plaintext, Buffer.from(context))]), keyId: kek.keyId };
  } finally {
    dataKey.fill(0);
  }
}

export async function decrypt(keks: readonly KeyEncryptionKey[], value: Encrypted, context: string): Promise<Buffer> {
  const kek = keks.find((k) => k.keyId === value.keyId);
  if (kek === undefined) throw new Error(`no key-encryption key with id ${value.keyId}`);
  const { ciphertext } = value;
  if (ciphertext.readUInt8(0) !== VERSION) throw new Error('unsupported ciphertext version');
  const wrappedLength = ciphertext.readUInt16BE(1);
  const dataKey = await kek.unwrap(ciphertext.subarray(3, 3 + wrappedLength));
  try {
    return open(dataKey, ciphertext.subarray(3 + wrappedLength), Buffer.from(context));
  } finally {
    dataKey.fill(0);
  }
}
