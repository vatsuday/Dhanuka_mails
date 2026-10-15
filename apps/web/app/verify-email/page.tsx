'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, messageFor, tokenFromHash } from '../../lib/api';

export default function VerifyEmailPage() {
  const [state, setState] = useState<'working' | 'verified' | 'failed'>('working');
  const [error, setError] = useState('');

  useEffect(() => {
    void api('/auth/verify-email', { token: tokenFromHash() }).then((result) => {
      if (result.ok) {
        setState('verified');
      } else {
        setState('failed');
        setError(messageFor(result.data.error));
      }
    });
  }, []);

  return (
    <main>
      <div className="card">
        <h1>Email confirmation</h1>
        {state === 'working' && <p>Confirming…</p>}
        {state === 'verified' && (
          <>
            <p className="success" role="status">Your email address is confirmed.</p>
            <p><Link href="/login">Log in</Link> to create your organisation.</p>
          </>
        )}
        {state === 'failed' && <p className="error" role="alert">{error}</p>}
      </div>
    </main>
  );
}
