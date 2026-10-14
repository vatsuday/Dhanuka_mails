// Boots every Node app as a real process and probes it (S0.8). Works without Docker:
// dependencies point at closed ports, so /ready must report 503 and name exactly the app's checks.
// Also verifies fail-fast config: an app started without its settings must exit 1 with a clear message.
// Usage: node scripts/smoke-apps.mjs   (exit code 0 = all checks passed)
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const APPS = [
  { name: 'api', port: 3001, checks: ['postgres', 'valkey-queue', 'valkey-cache'] },
  { name: 'tracker', port: 3002, checks: ['postgres', 'valkey-queue', 'valkey-cache'] },
  { name: 'worker', port: 3003, checks: ['postgres', 'valkey-queue'] },
  { name: 'webhook-worker', port: 3004, checks: ['postgres', 'valkey-queue'] },
  { name: 'admin', port: 3005, checks: ['postgres', 'valkey-cache'] },
];

async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Only what Node needs to run, so nothing from the developer's shell leaks into the test. */
function baseEnv() {
  const keep = ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'];
  return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}

function start(app, env) {
  const child = spawn(process.execPath, ['src/main.ts'], { cwd: path.join(root, 'apps', app.name), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, exited, output: () => output };
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) return res;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no /health response on port ${port} within ${timeoutMs} ms`);
}

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};

const pg = await closedPort();
const vq = await closedPort();
const vc = await closedPort();
const serviceEnv = {
  ...baseEnv(),
  APP_ENV: 'test',
  LOG_LEVEL: 'info',
  DATABASE_URL: `postgres://smoke:smoke@127.0.0.1:${pg}/smoke`,
  VALKEY_QUEUE_URL: `redis://127.0.0.1:${vq}`,
  VALKEY_CACHE_URL: `redis://127.0.0.1:${vc}`,
};

for (const app of APPS) {
  const proc = start(app, serviceEnv);
  try {
    const health = await waitForHealth(app.port, 20000);
    check(JSON.stringify(await health.json()) === '{"status":"ok"}', `${app.name}: GET /health -> 200 {"status":"ok"}`);
    check(typeof health.headers.get('x-request-id') === 'string', `${app.name}: response carries x-request-id`);
    const ready = await fetch(`http://127.0.0.1:${app.port}/ready`);
    const body = await ready.json();
    check(ready.status === 503, `${app.name}: GET /ready -> 503 while dependencies are down`);
    const names = body.checks.map((c) => c.name);
    check(JSON.stringify(names) === JSON.stringify(app.checks), `${app.name}: /ready checks are exactly [${app.checks.join(', ')}] (got [${names.join(', ')}])`);
    check(/"service":"[a-z-]+"/.test(proc.output()) && proc.output().includes(`"service":"${app.name}"`), `${app.name}: JSON logs tagged with service`);
  } catch (error) {
    check(false, `${app.name}: ${error.message}\n${proc.output().slice(-1500)}`);
  } finally {
    proc.child.kill('SIGTERM');
    const { code, signal } = await proc.exited;
    if (process.platform !== 'win32') {
      check(code === 0 && proc.output().includes('service stopped'), `${app.name}: graceful shutdown on SIGTERM (exit ${code}, signal ${signal})`);
    }
  }
}

// Fail fast: the api without its settings must exit 1 with a readable message naming the variables.
{
  const proc = start(APPS[0], { ...baseEnv() });
  const timer = setTimeout(() => proc.child.kill('SIGKILL'), 15000);
  const { code } = await proc.exited;
  clearTimeout(timer);
  const out = proc.output();
  check(code === 1, `fail-fast: api without config exits with code 1 (got ${code})`);
  check(out.includes('Invalid configuration') && out.includes('DATABASE_URL') && out.includes('VALKEY_QUEUE_URL'), 'fail-fast: message names the missing variables');
  check(!/\n\s+at .+\(.+:\d+:\d+\)/.test(out), 'fail-fast: no stack trace printed');
}

if (process.platform === 'win32') console.log('NOTE  graceful-shutdown check skipped on Windows (SIGTERM force-kills there); it runs in CI on Linux.');
console.log(failures.length === 0 ? '\nAll app smoke checks passed.' : `\n${failures.length} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
