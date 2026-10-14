// Runs the standalone production server produced by `next build` (output: 'standalone'), the same
// way the container will. Next.js leaves static assets out of the standalone folder, so they are
// copied in first. Defaults bind to 127.0.0.1:3000; set HOSTNAME=0.0.0.0 inside containers.
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appDir = path.resolve(import.meta.dirname, '..');
// outputFileTracingRoot is the workspace root, so the server lives under apps/web inside standalone.
const standaloneDir = path.join(appDir, '.next', 'standalone', 'apps', 'web');
const server = path.join(standaloneDir, 'server.js');

if (!existsSync(server)) {
  console.error('No standalone build found. Run `pnpm run build` first.');
  process.exit(1);
}

cpSync(path.join(appDir, '.next', 'static'), path.join(standaloneDir, '.next', 'static'), { recursive: true });
const publicDir = path.join(appDir, 'public');
if (existsSync(publicDir)) cpSync(publicDir, path.join(standaloneDir, 'public'), { recursive: true });

process.env.PORT ??= '3000';
process.env.HOSTNAME ??= '127.0.0.1';
await import(pathToFileURL(server).href);
