// ADR-017: Brevo provider against a fake fetch (no network). Request shape, batching rules, error
// classification, the API key kept out of errors, and the guard on batches.
import { describe, expect, it, vi } from 'vitest';
import { BrevoProvider, BREVO_MAX_BATCH } from '../src/brevo.ts';
import { guardedProvider, SendingBlockedError } from '../src/guard.ts';
import { ProviderError, type EmailMessage } from '../src/provider.ts';

const KEY = 'xkeysib-test-secret-key';

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  );
}

const message = (to: string, extra: Partial<EmailMessage> = {}): EmailMessage => ({
  from: { email: 'news@shop.example.in', name: 'Shop' },
  to: { email: to, name: 'Asha' },
  subject: `Hello ${to}`,
  text: 'Plain <text> & more',
  html: `<p>Hi ${to}</p>`,
  ...extra,
});

/** The JSON body and headers of the n-th call. */
function call(fetchMock: ReturnType<typeof fakeFetch>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n] ?? [];
  return { url, headers: init?.headers as Record<string, string>, body: JSON.parse(init?.body as string) as Record<string, unknown> };
}

describe('BrevoProvider.send', () => {
  it('posts one message to /v3/smtp/email with the api-key header and returns the message ID', async () => {
    const fetchMock = fakeFetch(201, { messageId: '<abc@smtp-relay.mailin.fr>' });
    const provider = new BrevoProvider({ apiKey: KEY, fetch: fetchMock });
    const result = await provider.send(message('asha@example.in', { headers: { 'X-DM-Message': 'm1' } }));
    expect(result).toEqual({ provider: 'brevo', providerMessageId: '<abc@smtp-relay.mailin.fr>' });
    const { url, headers, body } = call(fetchMock);
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(headers['api-key']).toBe(KEY);
    expect(body).toEqual({
      sender: { email: 'news@shop.example.in', name: 'Shop' },
      to: [{ email: 'asha@example.in', name: 'Asha' }],
      subject: 'Hello asha@example.in',
      htmlContent: '<p>Hi asha@example.in</p>',
      textContent: 'Plain <text> & more',
      headers: { 'X-DM-Message': 'm1' },
    });
  });

  it('renders text-only messages as escaped HTML, because Brevo requires htmlContent', async () => {
    const fetchMock = fakeFetch(201, { messageId: 'id' });
    const textOnly = message('a@example.in');
    delete textOnly.html;
    await new BrevoProvider({ apiKey: KEY, fetch: fetchMock }).send(textOnly);
    expect(call(fetchMock).body.htmlContent).toBe('<div style="white-space:pre-wrap">Plain &lt;text&gt; &amp; more</div>');
  });

  it('refuses an empty API key', () => {
    expect(() => new BrevoProvider({ apiKey: ' ' })).toThrow(/API key is required/);
  });
});

describe('BrevoProvider errors', () => {
  it.each([
    [400, { code: 'invalid_parameter', message: 'bad' }, false],
    [401, { code: 'unauthorized', message: `key ${KEY} is invalid` }, false],
    [402, { code: 'not_enough_credits', message: 'x' }, false],
    [429, { code: 'too_many_requests', message: 'x' }, true],
    [500, 'oops', true],
    [503, '', true],
  ])('HTTP %s is a ProviderError (retryable: %s); the key never appears', async (status, body, retryable) => {
    const provider = new BrevoProvider({ apiKey: KEY, fetch: fakeFetch(status, body) });
    const error = (await provider.send(message('a@example.in')).catch((e: unknown) => e)) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(retryable);
    expect(JSON.stringify({ message: error.message, stack: error.stack })).not.toContain(KEY);
  });

  it('keeps only a well-formed error code, never the error message (it may echo request data)', async () => {
    const provider = new BrevoProvider({ apiKey: KEY, fetch: fakeFetch(400, { code: 'invalid_parameter', message: 'asha@example.in is bad' }) });
    await expect(provider.send(message('a@example.in'))).rejects.toThrow('brevo: HTTP 400 (invalid_parameter)');
  });

  it('network failures and timeouts are retryable', async () => {
    const provider = new BrevoProvider({ apiKey: KEY, fetch: vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed'))) });
    await expect(provider.send(message('a@example.in'))).rejects.toMatchObject({ name: 'ProviderError', retryable: true });
  });

  it('a success without a message ID is an error', async () => {
    const provider = new BrevoProvider({ apiKey: KEY, fetch: fakeFetch(201, {}) });
    await expect(provider.send(message('a@example.in'))).rejects.toThrow(/no message ID/);
  });
});

describe('BrevoProvider.sendBatch', () => {
  it('sends many messages in one call as messageVersions and returns IDs in order', async () => {
    const fetchMock = fakeFetch(201, { messageIds: ['<1@x>', '<2@x>', '<3@x>'] });
    const provider = new BrevoProvider({ apiKey: KEY, fetch: fetchMock });
    const results = await provider.sendBatch([message('a@example.in'), message('b@example.in'), message('c@example.in')]);
    expect(results.map((r) => r.providerMessageId)).toEqual(['<1@x>', '<2@x>', '<3@x>']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { body } = call(fetchMock);
    expect(body.to).toBeUndefined(); // Brevo ignores an outer `to` when versions are used
    expect(body.messageVersions).toEqual([
      { to: [{ email: 'a@example.in', name: 'Asha' }], subject: 'Hello a@example.in', htmlContent: '<p>Hi a@example.in</p>', textContent: 'Plain <text> & more' },
      { to: [{ email: 'b@example.in', name: 'Asha' }], subject: 'Hello b@example.in', htmlContent: '<p>Hi b@example.in</p>', textContent: 'Plain <text> & more' },
      { to: [{ email: 'c@example.in', name: 'Asha' }], subject: 'Hello c@example.in', htmlContent: '<p>Hi c@example.in</p>', textContent: 'Plain <text> & more' },
    ]);
  });

  it('an empty batch makes no call', async () => {
    const fetchMock = fakeFetch(201, {});
    expect(await new BrevoProvider({ apiKey: KEY, fetch: fetchMock }).sendBatch([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it(`refuses more than ${String(BREVO_MAX_BATCH)} messages, mixed senders, or mixed headers`, async () => {
    const fetchMock = fakeFetch(201, {});
    const provider = new BrevoProvider({ apiKey: KEY, fetch: fetchMock });
    const many = Array.from({ length: BREVO_MAX_BATCH + 1 }, (_, i) => message(`u${String(i)}@example.in`));
    await expect(provider.sendBatch(many)).rejects.toThrow(/at most 1000/);
    await expect(provider.sendBatch([message('a@example.in'), message('b@example.in', { from: { email: 'other@shop.example.in' } })])).rejects.toThrow(/same sender/);
    await expect(
      provider.sendBatch([
        message('a@example.in', { headers: { 'List-Unsubscribe': '<https://u.example/a>' } }),
        message('b@example.in', { headers: { 'List-Unsubscribe': '<https://u.example/b>' } }),
      ]),
    ).rejects.toThrow(/same headers/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a response with the wrong number of IDs is an error', async () => {
    const provider = new BrevoProvider({ apiKey: KEY, fetch: fakeFetch(201, { messageIds: ['<1@x>'] }) });
    await expect(provider.sendBatch([message('a@example.in'), message('b@example.in')])).rejects.toThrow(/expected 2 message IDs/);
  });
});

describe('guarded Brevo batches (ADR-011, ADR-017)', () => {
  it('in sink mode Brevo is never called', async () => {
    const fetchMock = fakeFetch(201, { messageIds: ['<1@x>'] });
    const guarded = guardedProvider(new BrevoProvider({ apiKey: KEY, fetch: fetchMock }), () => 'sink');
    await expect(guarded.sendBatch?.([message('a@example.in')])).rejects.toBeInstanceOf(SendingBlockedError);
    await expect(guarded.send(message('a@example.in'))).rejects.toBeInstanceOf(SendingBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('in sandbox one external recipient blocks the whole batch before any call', async () => {
    const fetchMock = fakeFetch(201, { messageIds: ['<1@x>', '<2@x>'] });
    const guarded = guardedProvider(new BrevoProvider({ apiKey: KEY, fetch: fetchMock }), () => 'sandbox', { sandboxAllowlist: ['team@dhanuka.in'] });
    await expect(guarded.sendBatch?.([message('team@dhanuka.in'), message('customer@example.com')])).rejects.toBeInstanceOf(SendingBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
    const ok = await guarded.sendBatch?.([message('team@dhanuka.in'), message('Team@Dhanuka.in')]);
    expect(ok).toHaveLength(2);
  });

  it('exposes the batch limit, and providers without batching stay without it', () => {
    expect(guardedProvider(new BrevoProvider({ apiKey: KEY }), () => 'live').maxBatchSize).toBe(1000);
    const single = guardedProvider({ name: 'sink', send: () => Promise.resolve({ provider: 'sink', providerMessageId: 'x' }) }, () => 'sink');
    expect(single.sendBatch).toBeUndefined();
  });
});
