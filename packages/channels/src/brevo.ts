// Brevo transactional API provider (ADR-017). Single sends and batches of up to 1,000 messages
// (`messageVersions`). The API key is sent only in the `api-key` header and never appears in errors.
import { ProviderError, type ChannelProvider, type EmailMessage, type SendResult } from './provider.ts';

export const BREVO_API_URL = 'https://api.brevo.com';
/** Brevo's documented limits per request (read 2026-10-16). */
export const BREVO_MAX_BATCH = 1000;

export interface BrevoOptions {
  apiKey: string;
  /** Overridable for tests and a future EU endpoint. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface BrevoAddress {
  email: string;
  name?: string;
}

const address = (a: { email: string; name?: string | undefined }): BrevoAddress =>
  a.name === undefined || a.name === '' ? { email: a.email } : { email: a.email, name: a.name.slice(0, 70) };

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Brevo requires htmlContent; a text-only message gets a plain HTML rendering of its text. */
const htmlOf = (message: EmailMessage) =>
  message.html ?? `<div style="white-space:pre-wrap">${escapeHtml(message.text)}</div>`;

const sameHeaders = (a: EmailMessage['headers'], b: EmailMessage['headers']) =>
  JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

export class BrevoProvider implements ChannelProvider {
  readonly name = 'brevo';
  readonly maxBatchSize = BREVO_MAX_BATCH;
  readonly #apiKey: string;
  readonly #url: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: BrevoOptions) {
    if (options.apiKey.trim() === '') throw new Error('brevo: an API key is required');
    this.#apiKey = options.apiKey;
    this.#url = `${(options.baseUrl ?? BREVO_API_URL).replace(/\/+$/, '')}/v3/smtp/email`;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    const body = {
      sender: address(message.from),
      to: [address(message.to)],
      subject: message.subject,
      htmlContent: htmlOf(message),
      textContent: message.text,
      ...(message.headers === undefined ? {} : { headers: message.headers }),
    };
    const response = await this.#post(body);
    const messageId = response.messageId ?? response.messageIds?.[0];
    if (typeof messageId !== 'string') throw new ProviderError('brevo: response had no message ID');
    return { provider: this.name, providerMessageId: messageId };
  }

  /**
   * One API call for up to 1,000 messages. Brevo applies `sender` and `headers` to the whole request,
   * so every message must share them; otherwise send them one by one (ADR-017).
   */
  async sendBatch(messages: readonly EmailMessage[]): Promise<SendResult[]> {
    const [first] = messages;
    if (first === undefined) return [];
    if (messages.length > BREVO_MAX_BATCH) throw new ProviderError(`brevo: a batch holds at most ${String(BREVO_MAX_BATCH)} messages`);
    for (const m of messages) {
      if (m.from.email !== first.from.email || m.from.name !== first.from.name) throw new ProviderError('brevo: every message in a batch must have the same sender');
      if (!sameHeaders(m.headers, first.headers)) throw new ProviderError('brevo: every message in a batch must have the same headers');
    }
    const body = {
      sender: address(first.from),
      // Top-level defaults are required by the API; every version overrides them.
      subject: first.subject,
      htmlContent: htmlOf(first),
      ...(first.headers === undefined ? {} : { headers: first.headers }),
      messageVersions: messages.map((m) => ({
        to: [address(m.to)],
        subject: m.subject,
        htmlContent: htmlOf(m),
        textContent: m.text,
      })),
    };
    const response = await this.#post(body);
    const ids = response.messageIds;
    if (!Array.isArray(ids) || ids.length !== messages.length || !ids.every((id) => typeof id === 'string')) {
      throw new ProviderError(`brevo: expected ${String(messages.length)} message IDs in the response`);
    }
    return ids.map((id) => ({ provider: this.name, providerMessageId: id }));
  }

  async #post(body: object): Promise<{ messageId?: unknown; messageIds?: unknown[] }> {
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: 'POST',
        headers: { 'api-key': this.#apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      // The cause is a network or abort error; it carries no request headers.
      throw new ProviderError('brevo: request failed before a response', { cause: error, retryable: true });
    }
    if (response.ok) return (await response.json()) as { messageId?: unknown; messageIds?: unknown[] };

    // Brevo's error body is {code, message}. Only the code is kept: messages may echo request data.
    let code = 'unknown';
    try {
      const parsed = (await response.json()) as { code?: unknown };
      if (typeof parsed.code === 'string' && /^[a-z_]{1,64}$/.test(parsed.code)) code = parsed.code;
    } catch {
      // not JSON
    }
    const status = response.status;
    const retryable = status === 429 || status >= 500;
    throw new ProviderError(`brevo: HTTP ${String(status)} (${code})`, { status, retryable });
  }
}
