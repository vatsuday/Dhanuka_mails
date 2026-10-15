import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { bootstrapDatabase, type LoginRole } from '../src/bootstrap.ts';
import { runMigrations } from '../src/database.ts';

/** Same image as infra/docker/docker-compose.yml. */
const POSTGRES_IMAGE = 'postgres:18.6-bookworm';
const DATABASE = 'dhanuka_test';

export interface TestDatabase {
  container: StartedTestContainer;
  /** Superuser connection, for seeding and catalog checks only. */
  superuser: pg.Pool;
  pool: (role: LoginRole, max?: number) => pg.Pool;
  stop: () => Promise<void>;
}

/** Starts a throwaway Postgres, bootstraps the roles with random passwords and applies all migrations. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const secret = () => randomBytes(18).toString('base64url');
  const passwords: Record<LoginRole | 'superuser', string> = {
    superuser: secret(),
    app_migrator: secret(),
    app_user: secret(),
    admin_user: secret(),
  };
  const container = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({ POSTGRES_USER: 'bootstrap', POSTGRES_PASSWORD: passwords.superuser, POSTGRES_DB: DATABASE })
    .withExposedPorts(5432)
    // The entrypoint starts Postgres twice (init, then for real); wait for the second.
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const pools: pg.Pool[] = [];
  const connect = (user: string, password: string, max = 4) => {
    const pool = new pg.Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: DATABASE,
      user,
      password,
      max,
    });
    pools.push(pool);
    return pool;
  };

  const superuser = connect('bootstrap', passwords.superuser);
  const client = await superuser.connect();
  try {
    await bootstrapDatabase(client, passwords);
  } finally {
    client.release();
  }
  await runMigrations(connect('app_migrator', passwords.app_migrator, 1));

  return {
    container,
    superuser,
    pool: (role, max) => connect(role, passwords[role], max),
    stop: async () => {
      await Promise.all(pools.map((p) => p.end()));
      await container.stop();
    },
  };
}
