'use client';

import { useState, type SubmitEvent } from 'react';
import { api, messageFor } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api('/auth/password-reset/request', { email: new FormData(event.currentTarget).get('email') });
    if (result.ok) setSent(true);
    else setError(messageFor(result.data.error));
  }

  return (
    <main>
      <form className="card" onSubmit={(e) => void onSubmit(e)}>
        <h1>Reset your password</h1>
        {sent ? (
          <p role="status">If an account exists for that address, we sent a reset link. It expires in 1 hour.</p>
        ) : (
          <>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
            {error !== '' && <p className="error" role="alert">{error}</p>}
            <button type="submit">Send reset link</button>
          </>
        )}
      </form>
    </main>
  );
}
