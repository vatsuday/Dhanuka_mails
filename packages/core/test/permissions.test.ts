import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { slugify } from '../src/tenancy/organisations.ts';
import { can, canAssignRole, PERMISSIONS, type Permission, type Role } from '../src/tenancy/permissions.ts';

const ROLES: Role[] = ['owner', 'admin', 'marketer', 'developer', 'viewer'];

/** docs/02 §5 row label → the permission(s) implementing it. */
const DOC_ROWS: Record<string, Permission[]> = {
  'Billing, delete org, transfer ownership': ['billing:manage', 'org:delete', 'org:transfer'],
  'Manage members and roles (up to own role)': ['members:manage'],
  'Sending domains': ['domains:manage'],
  'API keys and webhooks': ['developer:manage'],
  'Contacts, lists, tags, import, segments': ['audience:write'],
  'Export contacts / erase contact': ['audience:export'],
  'Templates, campaigns (create/edit)': ['content:write'],
  'Send or schedule campaigns': ['campaigns:send'],
  'View reports, contacts, campaigns': ['reports:view'],
  'Audit log': ['audit:view'],
};

describe('permission matrix matches docs/02 §5 (S1.8 AC 1)', () => {
  const doc = readFileSync(new URL('../../../docs/02-architecture.md', import.meta.url), 'utf8');

  it.each(Object.entries(DOC_ROWS))('%s', (label, permissions) => {
    const line = doc.split(/\r?\n/).find((l) => l.startsWith(`| ${label} |`));
    expect(line, `row "${label}" not found in docs/02`).toBeDefined();
    const cells = (line ?? '').split('|').slice(2, 7).map((c) => c.trim());
    const allowedInDoc = ROLES.filter((_, i) => cells[i]?.startsWith('✅'));
    for (const permission of permissions) {
      expect(ROLES.filter((role) => can(role, permission)), permission).toEqual(allowedInDoc);
    }
  });

  it('suppression: owner and admin manage; marketer may only add', () => {
    expect(ROLES.filter((r) => can(r, 'suppression:manage'))).toEqual(['owner', 'admin']);
    expect(ROLES.filter((r) => can(r, 'suppression:add'))).toEqual(['owner', 'admin', 'marketer']);
  });

  it('every member can view the organisation', () => {
    expect(ROLES.every((r) => can(r, 'org:view'))).toBe(true);
  });

  it('covers every permission in the matrix', () => {
    const tested = new Set([...Object.values(DOC_ROWS).flat(), 'suppression:manage', 'suppression:add', 'org:view']);
    expect(Object.keys(PERMISSIONS).filter((p) => !tested.has(p))).toEqual([]);
  });
});

describe('role assignment is capped at the actor\'s own role', () => {
  it('admins can assign up to admin, never owner; others cannot assign', () => {
    expect(canAssignRole('owner', 'owner')).toBe(true);
    expect(canAssignRole('admin', 'admin')).toBe(true);
    expect(canAssignRole('admin', 'owner')).toBe(false);
    expect(canAssignRole('marketer', 'viewer')).toBe(false);
  });
});

describe('slugify', () => {
  it.each([
    ['Acme Corp', 'acme-corp'],
    ['  Rāma & Sons — Pvt. Ltd.  ', 'rama-sons-pvt-ltd'],
    ['!!!', 'org'],
    ['x'.repeat(60), 'x'.repeat(48)],
  ])('%j → %j', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});
