import path from 'node:path';
import type { NextConfig } from 'next';

const workspaceRoot = path.join(import.meta.dirname, '..', '..');

const config: NextConfig = {
  // Self-contained server output for the ECS container image (ADR-013).
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
