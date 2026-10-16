// S2.2 AC 1: an invitation never grants owner, nor a role above the inviter's own.
import { describe, expect, it } from 'vitest';
import { canGrant } from '../src/tenancy/invitations.ts';

describe('canGrant', () => {
  it('owner and admin can grant admin and every lower role, never owner', () => {
    for (const own of ['owner', 'admin'] as const) {
      expect(['admin', 'marketer', 'developer', 'viewer'].map((r) => canGrant(own, r))).toEqual([true, true, true, true]);
      expect(canGrant(own, 'owner')).toBe(false);
    }
  });

  it('lower roles cannot grant a role above their own', () => {
    expect(canGrant('marketer', 'admin')).toBe(false);
    expect(canGrant('developer', 'admin')).toBe(false);
    expect(canGrant('viewer', 'marketer')).toBe(false);
    expect(canGrant('viewer', 'viewer')).toBe(true);
    expect(canGrant('marketer', 'developer')).toBe(true);
  });

  it('rejects unknown roles', () => {
    expect(canGrant('owner', 'superuser')).toBe(false);
    expect(canGrant('owner', '')).toBe(false);
  });
});
