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
  /** `sink` for Mailpit; real providers (for example `ses`, `brevo`) use their own names. */
  readonly name: string;
  send: (message: EmailMessage) => Promise<SendResult>;
  /**
   * Optional: many messages in one provider call (ADR-017). Results are in input order. Providers
   * state their own limits (`maxBatchSize`) and refuse batches they cannot express.
   */
  sendBatch?: (messages: readonly EmailMessage[]) => Promise<SendResult[]>;
  readonly maxBatchSize?: number;
}

export interface ProviderErrorOptions extends ErrorOptions {
  /** True when the same message may succeed later (network, timeout, throttling, provider 5xx). */
  retryable?: boolean;
  /** The provider's HTTP status, when there was one. */
  status?: number;
}

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(message: string, options: ProviderErrorOptions = {}) {
    super(message, options);
    this.name = 'ProviderError';
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}
