'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { api, messageFor } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Set once the password is accepted for an account with MFA (S2.1): the second step asks for a code.
  const [challengeId, setChallengeId] = useState<string>();

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const result = await api<{ mfaRequired?: boolean; challengeId?: string }>('/auth/login', {
      email: form.get('email'),
      password: form.get('password'),
    });
    setBusy(false);
    if (result.ok && result.data.mfaRequired === true) setChallengeId(result.data.challengeId);
    else if (result.ok) router.push('/dashboard');
    else setError(messageFor(result.data.error));
  }

  async function onCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await api('/auth/login/mfa', { challengeId, code: new FormData(event.currentTarget).get('code') });
    setBusy(false);
    if (result.ok) {
      router.push('/dashboard');
      return;
    }
    // After 5 wrong codes or 5 minutes the challenge is gone: start again with the password.
    if (result.data.error === 'invalid_challenge') setChallengeId(undefined);
    setError(messageFor(result.data.error));
  }

  if (challengeId !== undefined) {
    return (
      <main>
        <form className="card" onSubmit={(e) => void onCode(e)}>
          <h1>Two-step verification</h1>
          <p className="muted">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
          <label htmlFor="code">Code</label>
          <input id="code" name="code" type="text" autoComplete="one-time-code" inputMode="text" maxLength={32} required autoFocus />
          {error !== '' && <p className="error" role="alert">{error}</p>}
          <button type="submit" disabled={busy}>Verify</button>
        </form>
      </main>
    );
  }

  return (
    <main>
      <form className="card" onSubmit={(e) => void onSubmit(e)}>
        <h1>Log in</h1>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {error !== '' && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>Log in</button>
        <p className="muted">
          <Link href="/forgot-password">Forgot your password?</Link> · <Link href="/signup">Create an account</Link>
        </p>
      </form>
    </main>
  );
}
