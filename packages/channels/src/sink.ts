import { ProviderError, type ChannelProvider, type EmailMessage, type SendResult } from './provider.ts';

/**
 * Delivers to Mailpit through its HTTP send API (`POST /api/v1/send`), so nothing ever leaves the
 * machine or the CI runner. Used when SENDING_MODE=sink (ADR-011).
 */
export class SinkProvider implements ChannelProvider {
  readonly name = 'sink';
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#fetch = fetchImpl;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    const body = {
      From: { Email: message.from.email, Name: message.from.name ?? '' },
      To: [{ Email: message.to.email, Name: message.to.name ?? '' }],
      Subject: message.subject,
      Text: message.text,
      ...(message.html === undefined ? {} : { HTML: message.html }),
      ...(message.headers === undefined ? {} : { Headers: message.headers }),
    };
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/api/v1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw new ProviderError('sink: Mailpit is unreachable', { cause: error });
    }
    if (!response.ok) throw new ProviderError(`sink: Mailpit returned HTTP ${String(response.status)}`);
    const { ID } = (await response.json()) as { ID?: unknown };
    if (typeof ID !== 'string') throw new ProviderError('sink: Mailpit returned no message ID');
    return { provider: this.name, providerMessageId: ID };
  }
}
