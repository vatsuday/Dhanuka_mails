// Channel abstraction (S1.5, ADR-003, ADR-011). Email only in the MVP; SMS and WhatsApp arrive in
// Release 2 behind the same interface.

export interface Address {
  email: string;
  name?: string;
}

export interface EmailMessage {
  from: Address;
  to: Address;
  subject: string;
  text: string;
  html?: string;
  headers?: Readonly<Record<string, string>>;
}

export interface SendResult {
  provider: string;
  providerMessageId: string;
}

export interface ChannelProvider {
  /** `sink` for Mailpit; real providers (for example `ses`) use their own names. */
  readonly name: string;
  send: (message: EmailMessage) => Promise<SendResult>;
}

export class ProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderError';
  }
}
