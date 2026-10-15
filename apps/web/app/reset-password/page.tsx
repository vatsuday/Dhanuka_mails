'use client';

import Link from 'next/link';
import { useState, type SubmitEvent } from 'react';
import { api, messageFor, tokenFromHash } from '../../lib/api';

export default function ResetPasswordPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('password');
    const result = await api('/auth/password-reset/confirm', { token: tokenFromHash(), password });
    if (result.ok) setDone(true);
    else setError(messageFor(result.data.error));
  }

  return (
    <main>
      <form className="card" onSubmit={(e) => void onSubmit(e)}>
        <h1>Choose a new password</h1>
        {done ? (
          <p className="success" role="status">
            Password changed. You have been logged out everywhere. <Link href="/login">Log in</Link>
          </p>
        ) : (
          <>
            <label htmlFor="password">New password</label>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={256} required />
            {error !== '' && <p className="error" role="alert">{error}</p>}
            <button type="submit">Change password</button>
          </>
        )}
      </form>
    </main>
  );
}
