import { describe, expect, it } from 'vitest';
import { accountExists, escapeHtml, invitation, passwordReset, verifyEmail } from '../src/templates.ts';

describe('system email templates', () => {
  it('each has a subject, plain text with the link, and HTML', () => {
    const url = 'https://app.example/verify?token=abc';
    for (const email of [
      verifyEmail({ url }),
      passwordReset({ url }),
      invitation({ organisation: 'Acme', inviter: 'Asha', role: 'marketer', url }),
    ]) {
      expect(email.subject).not.toBe('');
      expect(email.text).toContain(url);
      expect(email.html).toContain(escapeHtml(url));
    }
    const exists = accountExists({ loginUrl: 'https://a/login', resetUrl: 'https://a/reset' });
    expect(exists.text).toContain('https://a/login');
    expect(exists.text).toContain('https://a/reset');
  });

  it('escapes user-controlled values in HTML', () => {
    const html = invitation({ organisation: '<script>x</script>', inviter: '"Eve" & co', role: 'viewer', url: 'https://a/?a=1&b=2' }).html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;Eve&quot; &amp; co');
    expect(html).toContain('https://a/?a=1&amp;b=2');
    expect(verifyEmail({ name: '<b>Raj</b>', url: 'https://a' }).html).toContain('Hello &lt;b&gt;Raj&lt;/b&gt;,');
  });
});
