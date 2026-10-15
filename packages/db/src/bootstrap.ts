import { readFile } from 'node:fs/promises';
import type pg from 'pg';

const BOOTSTRAP_SQL = new URL('../sql/bootstrap.sql', import.meta.url);

/** Login roles whose password `bootstrapDatabase` may set. */
export const LOGIN_ROLES = ['app_migrator', 'app_user', 'admin_user'] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

/**
 * Creates the roles, the `app` schema and the base grants (sql/bootstrap.sql), then sets the
 * passwords that were given. Must run as a superuser. Idempotent. Passwords are sent as escaped
 * literals because ALTER ROLE cannot take bind parameters; they are never logged by this code.
 */
export async function bootstrapDatabase(
  client: pg.ClientBase,
  passwords: Partial<Record<LoginRole, string>> = {},
): Promise<void> {
  await client.query(await readFile(BOOTSTRAP_SQL, 'utf8'));
  for (const role of LOGIN_ROLES) {
    const password = passwords[role];
    if (password === undefined) continue;
    await client.query(`ALTER ROLE ${client.escapeIdentifier(role)} PASSWORD ${client.escapeLiteral(password)}`);
  }
}
