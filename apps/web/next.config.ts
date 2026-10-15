import path from 'node:path';
import type { NextConfig } from 'next';

const workspaceRoot = path.join(import.meta.dirname, '..', '..');
/** Where the api service listens; read at build and start time. */
const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

const config: NextConfig = {
  // Self-contained server output for the ECS container image (ADR-013).
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  poweredByHeader: false,
  reactStrictMode: true,
  // The browser talks only to this origin; /api/* is proxied to the api service (docs/02 §1), so the
  // session cookie stays first-party and the API's Origin check sees this app's origin.
  rewrites: () => Promise.resolve([{ source: '/api/:path*', destination: `${apiOrigin}/:path*` }]),
  headers: () =>
    Promise.resolve([
      {
        source: '/:path*',
        headers: [
          // Tokens arrive in URL fragments; never leak page URLs to other sites.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]),
};

export default config;
