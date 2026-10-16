'use client';

// Accept an invitation (S2.2). The token arrives in the URL fragment. If the visitor is not signed
// in, it is kept in sessionStorage and the login page brings them back here afterwards.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, messageFor, PENDING_INVITE_KEY, tokenFromHash } from '../../lib/api';

interface Preview {
  tenantName: string;
  email: string;
  role: string;
  expiresAt: string;
}

function readToken(): string {
  const fromHash = tokenFromHash();
  try {
    if (fromHash !== '') sessionStorage.setItem(PENDING_INVITE_KEY, fromHash);
    return fromHash !== '' ? fromHash : (sessionStorage.getItem(PENDING_INVITE_KEY) ?? '');
  } catch {
    return fromHash;
  }
}

function forgetToken() {
  try {
    sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // storage unavailable: nothing to forget
  }
}

export default function InvitePage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready' | 'invalid'>('loading');
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const current = readToken();
    setToken(current);
    void (async () => {
      if (current === '') {
        setState('invalid');
        return;
      }
      const result = await api<Preview>('/invitations/preview', { token: current });
      if (result.status === 401) setState('signed-out');
      else if (result.ok) {
        setPreview(result.data);
        setState('ready');
      } else {
        forgetToken();
        setState('invalid');
      }
    })();
  }, []);

  async function accept() {
    setBusy(true);
    setError('');
    const result = await api('/invitations/accept', { token });
    setBusy(false);
    if (result.ok || result.data.error === 'already_member') {
      forgetToken();
      router.push('/dashboard');
      return;
    }
    setError(messageFor(result.data.error));
  }

  return (
    <main>
      <div className="card">
        <h1>Invitation</h1>
        {state === 'loading' && <p>Loading…</p>}
        {state === 'invalid' && <p className="error" role="alert">{messageFor('invalid_token')}</p>}
        {state === 'signed-out' && (
          <>
            <p>Log in, or create an account with the email address the invitation was sent to. Then open the invitation link again if you are not brought back here.</p>
            <p>
              <Link href="/login">Log in</Link> · <Link href="/signup">Create an account</Link>
            </p>
          </>
        )}
        {state === 'ready' && preview !== undefined && (
          <>
            <p>
              You&apos;re invited to join <strong>{preview.tenantName}</strong> as <span className="badge">{preview.role}</span>
            </p>
            <p className="muted">For {preview.email}. Expires {new Date(preview.expiresAt).toLocaleDateString()}.</p>
            {error !== '' && <p className="error" role="alert">{error}</p>}
            <button type="button" disabled={busy} onClick={() => void accept()}>Accept invitation</button>
          </>
        )}
      </div>
    </main>
  );
}
