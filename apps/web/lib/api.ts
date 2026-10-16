// Browser-side API client. Same origin (/api is rewritten to the api service), so the browser sends
// the session cookie and an Origin header the API accepts.
export interface ApiResult<T> {
  status: number;
  ok: boolean;
  data: T & { error?: string };
}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<ApiResult<T>> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const data = (text === '' ? {} : JSON.parse(text)) as T & { error?: string };
  return { status: response.status, ok: response.ok, data };
}

/** sessionStorage key holding an invitation token while the visitor logs in or signs up (S2.2). */
export const PENDING_INVITE_KEY = 'dm.pendingInvite';

/** Where to go after logging in: back to a pending invitation, else the dashboard. */
export function afterLoginPath(): string {
  try {
    return sessionStorage.getItem(PENDING_INVITE_KEY) === null ? '/dashboard' : '/invite';
  } catch {
    return '/dashboard';
  }
}

/** The token from a link like /verify-email#token=…, which never reaches any server. */
export function tokenFromHash(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
}

const MESSAGES: Record<string, string> = {
  invalid_email: 'Enter a valid email address.',
  password_too_short: 'Use at least 10 characters.',
  password_too_long: 'Use at most 256 characters.',
  password_breached: 'This password appears in known data breaches. Choose another one.',
  outdated_terms: 'The terms have changed. Reload the page and accept the current version.',
  rate_limited: 'Too many attempts. Wait a little and try again.',
  invalid_credentials: 'Email or password is incorrect.',
  invalid_token: 'This link is invalid or has expired. Request a new one.',
  email_not_verified: 'Confirm your email address before creating an organisation.',
  invalid_name: 'Organisation names must be 2 to 120 characters.',
  invalid_request: 'Please check the form and try again.',
  bad_origin: 'This request was blocked. Reload the page and try again.',
  invalid_code: 'That code is not valid. Check your authenticator app and try again.',
  invalid_challenge: 'Your sign-in expired. Enter your email and password again.',
  mfa_required: 'This organisation requires two-step verification. Turn it on below to continue.',
  enable_mfa_first: 'Turn on two-step verification for your own account first.',
  already_enabled: 'Two-step verification is already on.',
  no_pending_enrolment: 'Start the setup again.',
  email_mismatch: 'This invitation was sent to a different email address. Log in with that address to accept it.',
  already_member: 'This person is already a member.',
  role_not_allowed: 'You cannot give someone a role higher than your own.',
  forbidden: 'You do not have permission to do that.',
  not_found: 'That item no longer exists.',
};

export function messageFor(error: string | undefined): string {
  return (error === undefined ? undefined : MESSAGES[error]) ?? 'Something went wrong. Please try again.';
}
