// System email templates (S1.5 AC 4). Platform-authored, so plain functions are enough; tenant
// templates use LiquidJS (ADR-008). Every interpolated value is HTML-escaped.

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

function layout(heading: string, paragraphs: string[], action?: { label: string; url: string }): string {
  const button =
    action === undefined
      ? ''
      : `<p><a href="${escapeHtml(action.url)}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="color:#555;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>`;
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:560px">
<h1 style="font-size:20px">${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
${button}
<p style="color:#555;font-size:13px">Dhanuka Mails</p>
</body></html>`;
}

export function verifyEmail(input: { name?: string; url: string }): RenderedEmail {
  const greeting = input.name === undefined || input.name === '' ? 'Hello,' : `Hello ${input.name},`;
  const lines = [greeting, 'Confirm your email address to finish creating your Dhanuka Mails account. The link expires in 24 hours.'];
  return {
    subject: 'Confirm your email address',
    text: `${lines.join('\n\n')}\n\n${input.url}\n\nIf you didn't sign up, you can ignore this email.\n`,
    html: layout('Confirm your email address', [...lines, "If you didn't sign up, you can ignore this email."], {
      label: 'Confirm email',
      url: input.url,
    }),
  };
}

/** Sent instead of a verification email when someone signs up with an address that already has an account. */
export function accountExists(input: { loginUrl: string; resetUrl: string }): RenderedEmail {
  const lines = [
    'Someone tried to create a Dhanuka Mails account with this email address, but you already have one.',
    `Log in: ${input.loginUrl}`,
    `Forgot your password? Reset it: ${input.resetUrl}`,
    "If this wasn't you, you can ignore this email. Your account has not changed.",
  ];
  return {
    subject: 'You already have a Dhanuka Mails account',
    text: `${lines.join('\n\n')}\n`,
    html: layout('You already have an account', lines),
  };
}

export function passwordReset(input: { url: string }): RenderedEmail {
  const lines = ['We received a request to reset your Dhanuka Mails password. The link expires in 1 hour and works once.'];
  const after = "If you didn't ask for this, ignore this email. Your password stays the same.";
  return {
    subject: 'Reset your password',
    text: `${lines.join('\n\n')}\n\n${input.url}\n\n${after}\n`,
    html: layout('Reset your password', [...lines, after], { label: 'Reset password', url: input.url }),
  };
}

export function invitation(input: { organisation: string; inviter: string; role: string; url: string }): RenderedEmail {
  const lines = [
    `${input.inviter} invited you to join ${input.organisation} on Dhanuka Mails as ${input.role}.`,
    'The invitation expires in 7 days.',
  ];
  return {
    subject: `You're invited to ${input.organisation} on Dhanuka Mails`,
    text: `${lines.join('\n\n')}\n\n${input.url}\n`,
    html: layout(`Join ${input.organisation}`, lines, { label: 'Accept invitation', url: input.url }),
  };
}
