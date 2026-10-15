// Minimal cookie handling for the session cookie only (no extra dependency).
import { ABSOLUTE_TIMEOUT_MS, SESSION_COOKIE } from '@dm/core';

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * `__Host-` prefix: the browser only accepts it with Secure, Path=/ and no Domain, so no subdomain
 * can set or overwrite it (S1.2 AC 1). Browsers treat http://localhost and 127.0.0.1 as secure contexts.
 */
export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${String(ABSOLUTE_TIMEOUT_MS / 1000)}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
