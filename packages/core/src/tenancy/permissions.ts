// Permission matrix (docs/02 §5, S1.8 AC 1). Enforcement is in the service layer and on every route.
import type { MEMBERSHIP_ROLES } from '@dm/db';

export type Role = (typeof MEMBERSHIP_ROLES)[number];

/** One entry per row of the docs/02 §5 table, plus `org:view`, which every member has. */
export const PERMISSIONS = {
  'billing:manage': ['owner'],
  'org:delete': ['owner'],
  'org:transfer': ['owner'],
  'members:manage': ['owner', 'admin'],
  'domains:manage': ['owner', 'admin'],
  'developer:manage': ['owner', 'admin', 'developer'], // API keys and webhooks
  'audience:write': ['owner', 'admin', 'marketer'], // contacts, lists, tags, import, segments
  'audience:export': ['owner', 'admin'], // export contacts, erase a contact
  'content:write': ['owner', 'admin', 'marketer'], // templates, campaigns (create/edit)
  'campaigns:send': ['owner', 'admin', 'marketer'], // send or schedule
  'suppression:manage': ['owner', 'admin'],
  'suppression:add': ['owner', 'admin', 'marketer'], // marketers may add, not remove
  'reports:view': ['owner', 'admin', 'marketer', 'developer', 'viewer'], // reports, contacts, campaigns
  'audit:view': ['owner', 'admin'],
  'org:view': ['owner', 'admin', 'marketer', 'developer', 'viewer'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Members may grant roles only up to their own (docs/02 §5, "up to own role"). */
const RANK: Record<Role, number> = { viewer: 0, developer: 1, marketer: 1, admin: 2, owner: 3 };
export function canAssignRole(actor: Role, target: Role): boolean {
  return can(actor, 'members:manage') && RANK[target] <= RANK[actor];
}
