// Database admin commands:
//   pnpm db:bootstrap  roles, schema and grants, as a superuser (DATABASE_BOOTSTRAP_URL)
//   pnpm db:migrate    pending migrations, as app_migrator (DATABASE_MIGRATOR_URL)
// Errors name the missing variables but never print their values.
import pg from 'pg';
import { bootstrapDatabase, LOGIN_ROLES, type LoginRole } from './bootstrap.ts';
import { runMigrations } from './database.ts';

const PASSWORD_VARS: Record<LoginRole, string> = {
  app_migrator: 'APP_MIGRATOR_PASSWORD',
  app_user: 'APP_USER_PASSWORD',
  admin_user: 'ADMIN_USER_PASSWORD',
};

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

const command = process.argv[2];

if (command === 'bootstrap') {
  const client = new pg.Client({ connectionString: required('DATABASE_BOOTSTRAP_URL') });
  const passwords: Partial<Record<LoginRole, string>> = {};
  for (const role of LOGIN_ROLES) {
    const value = process.env[PASSWORD_VARS[role]];
    if (value !== undefined && value !== '') passwords[role] = value;
  }
  await client.connect();
  try {
    await bootstrapDatabase(client, passwords);
  } finally {
    await client.end();
  }
  console.log(`bootstrap done; passwords set for: ${Object.keys(passwords).join(', ') || '(none)'}`);
} else if (command === 'migrate') {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATOR_URL'), max: 1 });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
  console.log('migrations applied');
} else {
  console.error('usage: cli.ts bootstrap|migrate');
  process.exit(1);
}
