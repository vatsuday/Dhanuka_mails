// SinkProvider against a real Mailpit (same image as docker-compose).
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SinkProvider } from '../../src/sink.ts';
import { verifyEmail } from '../../src/templates.ts';

let mailpit: StartedTestContainer;
let baseUrl: string;

beforeAll(async () => {
  mailpit = await new GenericContainer('axllent/mailpit:v1.31.5')
    .withExposedPorts(8025)
    .withWaitStrategy(Wait.forHttp('/readyz', 8025))
    .start();
  baseUrl = `http://${mailpit.getHost()}:${String(mailpit.getMappedPort(8025))}`;
});
afterAll(async () => {
  await mailpit.stop();
});

it('delivers a system email to Mailpit with its subject, body and headers', async () => {
  const provider = new SinkProvider(baseUrl);
  const email = verifyEmail({ name: 'Asha', url: 'https://app.example/verify?token=t0k3n' });
  const result = await provider.send({
    from: { email: 'no-reply@dhanuka.local', name: 'Dhanuka Mails' },
    to: { email: 'asha@example.in' },
    ...email,
    headers: { 'X-DM-Template': 'verify-email' },
  });
  expect(result.provider).toBe('sink');

  const message = (await (await fetch(`${baseUrl}/api/v1/message/${result.providerMessageId}`)).json()) as {
    Subject: string; Text: string; HTML: string; To: { Address: string }[];
  };
  expect(message.Subject).toBe('Confirm your email address');
  expect(message.To.map((t) => t.Address)).toEqual(['asha@example.in']);
  expect(message.Text).toContain('https://app.example/verify?token=t0k3n');
  expect(message.HTML).toContain('Confirm email');
  const headers = (await (await fetch(`${baseUrl}/api/v1/message/${result.providerMessageId}/headers`)).json()) as Record<string, string[]>;
  expect(headers['X-Dm-Template'] ?? headers['X-DM-Template']).toEqual(['verify-email']);
});

it('fails with a ProviderError when Mailpit is unreachable', async () => {
  await expect(new SinkProvider('http://127.0.0.1:1').send({
    from: { email: 'a@b.c' }, to: { email: 'd@e.f' }, subject: 's', text: 't',
  })).rejects.toThrow('sink: Mailpit is unreachable');
});
