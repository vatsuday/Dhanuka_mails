// SendingModeGuard (ADR-011). Wraps a provider and decides, immediately before the network call,
// whether a message may go out. Effective mode = the stricter of the platform and tenant modes.
import type { ChannelProvider, EmailMessage, SendResult } from './provider.ts';

export const SENDING_MODES = ['sink', 'sandbox', 'live'] as const;
export type SendingMode = (typeof SENDING_MODES)[number];

/** Strictest first. */
const STRICTNESS: Record<SendingMode, number> = { sink: 0, sandbox: 1, live: 2 };

export function effectiveMode(platform: SendingMode, tenant?: SendingMode): SendingMode {
  if (tenant === undefined) return platform;
  return STRICTNESS[tenant] < STRICTNESS[platform] ? tenant : platform;
}

/** SES mailbox simulator addresses are always safe: SES never delivers them anywhere. */
const SES_SIMULATOR_DOMAIN = 'simulator.amazonses.com';

export type RecipientClass = 'ses-simulator' | 'allowlisted' | 'external';

export interface GuardOptions {
  /** Platform-verified team addresses allowed in sandbox mode (exact match, case-insensitive). */
  sandboxAllowlist?: readonly string[];
}

export class SendingBlockedError extends Error {
  readonly mode: SendingMode;
  readonly recipientClass: RecipientClass;

  constructor(mode: SendingMode, recipientClass: RecipientClass, reason: string) {
    super(`sending blocked in ${mode} mode: ${reason}`);
    this.name = 'SendingBlockedError';
    this.mode = mode;
    this.recipientClass = recipientClass;
  }
}

export function classifyRecipient(email: string, allowlist: readonly string[] = []): RecipientClass {
  const address = email.trim().toLowerCase();
  if (address.endsWith(`@${SES_SIMULATOR_DOMAIN}`)) return 'ses-simulator';
  if (allowlist.some((allowed) => allowed.trim().toLowerCase() === address)) return 'allowlisted';
  return 'external';
}

/**
 * Throws SendingBlockedError when the message may not be sent:
 * - sink: only the sink provider may be used; no message reaches a real provider.
 * - sandbox: a real provider may be used, but only for SES simulator and allowlisted addresses.
 * - live: everything allowed (production only; enforced at start-up by loadConfig).
 */
export function assertSendable(mode: SendingMode, providerName: string, recipient: string, options: GuardOptions = {}): void {
  const recipientClass = classifyRecipient(recipient, options.sandboxAllowlist);
  if (mode === 'sink') {
    if (providerName !== 'sink') {
      throw new SendingBlockedError(mode, recipientClass, `provider "${providerName}" is not the sink`);
    }
    return;
  }
  if (mode === 'sandbox' && providerName !== 'sink' && recipientClass === 'external') {
    throw new SendingBlockedError(mode, recipientClass, 'recipient is neither an SES simulator nor allowlisted address');
  }
}

/** A provider that enforces the guard on every send. Callers only ever get the guarded provider. */
export function guardedProvider(
  provider: ChannelProvider,
  mode: () => SendingMode,
  options: GuardOptions = {},
): ChannelProvider {
  return {
    name: provider.name,
    // async, so a blocked send is a rejected promise like any other send failure.
    send: async (message: EmailMessage): Promise<SendResult> => {
      assertSendable(mode(), provider.name, message.to.email, options);
      return provider.send(message);
    },
  };
}
