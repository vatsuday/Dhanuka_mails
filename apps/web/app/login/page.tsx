'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { api, messageFor } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const result = await api('/auth/login', { email: form.get('email'), password: form.get('password') });
    setBusy(false);
    if (result.ok) router.push('/dashboard');
    else setError(messageFor(result.data.error));
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
