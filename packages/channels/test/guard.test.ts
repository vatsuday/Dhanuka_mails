import { describe, expect, it, vi } from 'vitest';
import {
  assertSendable,
  classifyRecipient,
  effectiveMode,
  guardedProvider,
  SendingBlockedError,
  type RecipientClass,
  type SendingMode,
} from '../src/guard.ts';
import type { ChannelProvider } from '../src/provider.ts';

const ALLOWLIST = ['Team@Dhanuka.in'];
const RECIPIENTS: Record<RecipientClass, string> = {
  'ses-simulator': 'success@simulator.amazonses.com',
  allowlisted: 'team@dhanuka.in',
  external: 'customer@example.com',
};

/** Expected outcome for every mode × provider × recipient class (ADR-011). */
const MATRIX: [SendingMode, 'sink' | 'ses' | 'brevo', RecipientClass, 'allowed' | 'blocked'][] = [
  ['sink', 'sink', 'ses-simulator', 'allowed'],
  ['sink', 'sink', 'allowlisted', 'allowed'],
  ['sink', 'sink', 'external', 'allowed'], // delivered to Mailpit only
  ['sink', 'ses', 'ses-simulator', 'blocked'],
  ['sink', 'ses', 'allowlisted', 'blocked'],
  ['sink', 'ses', 'external', 'blocked'],
  ['sandbox', 'sink', 'external', 'allowed'],
  ['sandbox', 'ses', 'ses-simulator', 'allowed'],
  ['sandbox', 'ses', 'allowlisted', 'allowed'],
  ['sandbox', 'ses', 'external', 'blocked'],
  ['live', 'ses', 'ses-simulator', 'allowed'],
  ['live', 'ses', 'allowlisted', 'allowed'],
  ['live', 'ses', 'external', 'allowed'],
  // ADR-017: Brevo really delivers, so SES simulator addresses are not safe through it.
  ['sink', 'brevo', 'allowlisted', 'blocked'],
  ['sink', 'brevo', 'external', 'blocked'],
  ['sandbox', 'brevo', 'ses-simulator', 'blocked'],
  ['sandbox', 'brevo', 'allowlisted', 'allowed'],
  ['sandbox', 'brevo', 'external', 'blocked'],
  ['live', 'brevo', 'external', 'allowed'],
];

describe('assertSendable', () => {
  it.each(MATRIX)('%s mode, %s provider, %s recipient: %s', (mode, provider, recipientClass, expected) => {
    const call = () => { assertSendable(mode, provider, RECIPIENTS[recipientClass], { sandboxAllowlist: ALLOWLIST }); };
    if (expected === 'allowed') expect(call).not.toThrow();
    else expect(call).toThrow(SendingBlockedError);
  });

  it('reports the mode and recipient class on the error', () => {
    try {
      assertSendable('sandbox', 'ses', 'x@example.com');
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ mode: 'sandbox', recipientClass: 'external' });
    }
  });
});

describe('classifyRecipient', () => {
  it('matches the allowlist exactly and case-insensitively', () => {
    expect(classifyRecipient(' TEAM@dhanuka.in ', ALLOWLIST)).toBe('allowlisted');
    expect(classifyRecipient('team@dhanuka.in.evil.com', ALLOWLIST)).toBe('external');
    expect(classifyRecipient('xteam@dhanuka.in', ALLOWLIST)).toBe('external');
  });

  it('does not treat look-alike simulator domains as the simulator', () => {
    expect(classifyRecipient('bounce@SIMULATOR.amazonses.com')).toBe('ses-simulator');
    expect(classifyRecipient('a@simulator.amazonses.com.evil.com')).toBe('external');
    expect(classifyRecipient('a@notsimulator.amazonses.com')).toBe('external');
  });
});

describe('effectiveMode', () => {
  it('is the stricter of the platform and tenant modes', () => {
    expect(effectiveMode('live', 'sandbox')).toBe('sandbox');
    expect(effectiveMode('sandbox', 'live')).toBe('sandbox');
    expect(effectiveMode('sink', 'live')).toBe('sink');
    expect(effectiveMode('live')).toBe('live');
  });
});

describe('guardedProvider', () => {
  const message = { from: { email: 'no-reply@dhanuka.in' }, to: { email: 'customer@example.com' }, subject: 's', text: 't' };

  it('never calls the provider when the guard blocks', async () => {
    const send = vi.fn<ChannelProvider['send']>();
    const provider = guardedProvider({ name: 'ses', send }, () => 'sandbox');
    await expect(provider.send(message)).rejects.toThrow(SendingBlockedError);
    expect(send).not.toHaveBeenCalled();
  });

  it('reads the mode on every send', async () => {
    let mode: SendingMode = 'live';
    const send = vi.fn<ChannelProvider['send']>().mockResolvedValue({ provider: 'ses', providerMessageId: '1' });
    const provider = guardedProvider({ name: 'ses', send }, () => mode);
    await provider.send(message);
    mode = 'sink';
    await expect(provider.send(message)).rejects.toThrow(SendingBlockedError);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
