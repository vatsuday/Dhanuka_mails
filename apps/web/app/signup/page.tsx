'use client';

import Link from 'next/link';
import { useState, type SubmitEvent } from 'react';
import { api, messageFor } from '../../lib/api';

/** Must match CURRENT_TERMS_VERSION / CURRENT_AUP_VERSION in @dm/core. */
const TERMS_VERSION = '2026-10-15';
const AUP_VERSION = '2026-10-15';

export default function SignupPage() {
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const result = await api('/auth/signup', {
      name: form.get('name'),
      email: form.get('email'),
      password: form.get('password'),
      termsVersion: TERMS_VERSION,
      aupVersion: AUP_VERSION,
    });
    setBusy(false);
    if (result.ok) setDone(true);
    else setError(messageFor(result.data.error));
  }

  if (done) {
    return (
      <main>
        <div className="card">
          <h1>Check your email</h1>
          <p>We sent a confirmation link. It expires in 24 hours.</p>
          <p className="muted">
            Didn&apos;t get it? Check spam, or <Link href="/login">log in</Link> and resend it from your dashboard.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <form className="card" onSubmit={(e) => void onSubmit(e)}>
        <h1>Create your account</h1>
        <label htmlFor="name">Your name</label>
        <input id="name" name="name" type="text" autoComplete="name" maxLength={200} />
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={256} required />
        <p className="muted">At least 10 characters. Avoid passwords you use elsewhere.</p>
        <label className="check">
          <input name="accept" type="checkbox" required />
          <span>I accept the Terms of Service and the Acceptable Use Policy (version {TERMS_VERSION}).</span>
        </label>
        {error !== '' && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>Create account</button>
        <p className="muted">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}
