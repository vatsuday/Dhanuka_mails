'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { api, messageFor } from '../../lib/api';

interface Me {
  user: { id: string; email: string; name: string | null; emailVerified: boolean };
  organisations: { tenantId: string; tenantName: string; role: string; tenantStatus: string }[];
  currentTenantId: string | null;
}
interface Current {
  role: string;
  organisation: { name: string; slug: string; status: string; currency: string; timezone: string; locale: string };
}

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me>();
  const [current, setCurrent] = useState<Current>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const result = await api<Me>('/me');
    if (result.status === 401) {
      router.replace('/login');
      return;
    }
    setMe(result.data);
    if (result.data.currentTenantId === null) setCurrent(undefined);
    else setCurrent((await api<Current>('/orgs/current')).data);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createOrg(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError('');
    const result = await api('/orgs', { name: new FormData(formElement).get('name') });
    if (!result.ok) {
      setError(messageFor(result.data.error));
      return;
    }
    formElement.reset();
    await load();
  }

  async function select(tenantId: string) {
    await api('/orgs/select', { tenantId });
    await load();
  }

  async function resend() {
    if (me === undefined) return;
    await api('/auth/resend-verification', { email: me.user.email });
    setNotice('We sent a new confirmation link.');
  }

  async function logout() {
    await api('/auth/logout', {});
    router.replace('/login');
  }

  if (me === undefined) return <main><p>Loading…</p></main>;

  return (
    <main className="wide">
      <div className="card row">
        <div>
          <h1>Hello{me.user.name === null ? '' : `, ${me.user.name}`}</h1>
          <span className="muted">{me.user.email}</span>
        </div>
        <button type="button" className="secondary" onClick={() => void logout()}>Log out</button>
      </div>

      {!me.user.emailVerified && (
        <div className="card">
          <h2>Confirm your email</h2>
          <p>Confirm your email address to create an organisation.</p>
          {notice === '' ? <button type="button" onClick={() => void resend()}>Resend confirmation link</button> : <p className="success">{notice}</p>}
        </div>
      )}

      {current !== undefined && (
        <div className="card">
          <h2>{current.organisation.name}</h2>
          <p>
            <span className="badge">{current.role}</span> <span className="badge">{current.organisation.status.replace('_', ' ')}</span>
          </p>
          <p className="muted">
            {current.organisation.currency} · {current.organisation.timezone} · {current.organisation.locale}
          </p>
          {current.organisation.status === 'pending_review' && (
            <p className="muted">New organisations start in sandbox mode until our team reviews them.</p>
          )}
        </div>
      )}

      <div className="card">
        <h2>Your organisations</h2>
        {me.organisations.length === 0 ? (
          <p className="muted">You don&apos;t belong to an organisation yet.</p>
        ) : (
          <ul className="plain">
            {me.organisations.map((org) => (
              <li key={org.tenantId} className="row">
                <span>
                  {org.tenantName} <span className="badge">{org.role}</span>
                </span>
                {org.tenantId === me.currentTenantId ? (
                  <span className="muted">Current</span>
                ) : (
                  <button type="button" className="secondary" onClick={() => void select(org.tenantId)}>Switch</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {me.user.emailVerified && (
        <form className="card" onSubmit={(e) => void createOrg(e)}>
          <h2>Create an organisation</h2>
          <label htmlFor="org-name">Organisation name</label>
          <input id="org-name" name="name" type="text" minLength={2} maxLength={120} required />
          {error !== '' && <p className="error" role="alert">{error}</p>}
          <button type="submit">Create organisation</button>
        </form>
      )}
    </main>
  );
}
