'use client';

// Members and invitations (S2.2). Everyone sees the member list; owners and admins can invite and revoke.
import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { api, messageFor } from '../../lib/api';

interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  mfaEnabled: boolean;
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

const INVITABLE: Record<string, string[]> = {
  owner: ['admin', 'marketer', 'developer', 'viewer'],
  admin: ['admin', 'marketer', 'developer', 'viewer'],
};

export function MembersCard({ role }: { role: string }) {
  const canManage = role in INVITABLE;
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setMembers((await api<{ members?: Member[] }>('/orgs/current/members')).data.members ?? []);
    if (canManage) setInvitations((await api<{ invitations?: Invitation[] }>('/orgs/current/invitations')).data.invitations ?? []);
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = form.get('email');
    setError('');
    setNotice('');
    const result = await api('/orgs/current/invitations', { email, role: form.get('role') });
    if (!result.ok) {
      setError(messageFor(result.data.error));
      return;
    }
    setNotice(`Invitation sent to ${typeof email === 'string' ? email : 'them'}.`);
    formElement.reset();
    await load();
  }

  async function revoke(id: string) {
    setError('');
    setNotice('');
    const result = await api(`/orgs/current/invitations/${id}/revoke`, {});
    if (!result.ok) setError(messageFor(result.data.error));
    await load();
  }

  return (
    <div className="card">
      <h2>Members</h2>
      <ul className="plain">
        {members.map((m) => (
          <li key={m.userId} className="row">
            <span>
              {m.name ?? m.email} {m.name !== null && <span className="muted">{m.email}</span>}
            </span>
            <span>
              <span className="badge">{m.role}</span> {m.mfaEnabled && <span className="badge">2-step</span>}
            </span>
          </li>
        ))}
      </ul>

      {canManage && (
        <>
          {invitations.length > 0 && (
            <>
              <h3>Pending invitations</h3>
              <ul className="plain">
                {invitations.map((i) => {
                  const expired = new Date(i.expiresAt).getTime() < Date.now();
                  return (
                    <li key={i.id} className="row">
                      <span>
                        {i.email} <span className="badge">{i.role}</span>{' '}
                        <span className="muted">{expired ? 'expired' : `expires ${new Date(i.expiresAt).toLocaleDateString()}`}</span>
                      </span>
                      <button type="button" className="secondary" onClick={() => void revoke(i.id)}>Revoke</button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <form onSubmit={(e) => void invite(e)}>
            <h3>Invite someone</h3>
            <label htmlFor="invite-email">Email</label>
            <input id="invite-email" name="email" type="email" required />
            <label htmlFor="invite-role">Role</label>
            <select id="invite-role" name="role" defaultValue="marketer">
              {(INVITABLE[role] ?? []).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button type="submit">Send invitation</button>
          </form>
        </>
      )}
      {notice !== '' && <p className="success">{notice}</p>}
      {error !== '' && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
