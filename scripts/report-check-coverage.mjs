// Reports how many workspace packages define each CI check script.
// The root scripts use `pnpm -r --if-present`, so a check that no package defines runs nothing and
// still exits 0. This makes that "zero checks" condition explicit in CI logs and the job summary.
// Informational only: it exits 0 unless the workspace can't be read.
import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CHECKS = ['lint', 'typecheck', 'test:unit', 'test:integration', 'build', 'test:e2e'];
const root = process.cwd();
const inGitHub = process.env.GITHUB_ACTIONS === 'true';

// A fixed command string with no external input; runs through the shell so the pnpm .cmd shim resolves on Windows.
const listing = execSync('pnpm ls -r --depth -1 --json', { encoding: 'utf8' });
const packages = JSON.parse(listing).filter((p) => path.resolve(p.path) !== path.resolve(root));

const rows = CHECKS.map((check) => {
  const definers = packages.filter((p) => {
    const manifest = JSON.parse(readFileSync(path.join(p.path, 'package.json'), 'utf8'));
    return Boolean(manifest.scripts?.[check]);
  });
  return { check, count: definers.length, names: definers.map((p) => p.name) };
});

console.log(`Workspace packages: ${packages.length}`);
for (const { check, count, names } of rows) {
  console.log(`${check.padEnd(17)} ${count} package(s)${count ? `: ${names.join(', ')}` : ''}`);
  if (count === 0) {
    const message = `No workspace package defines "${check}"; this CI step runs zero checks.`;
    console.log(inGitHub ? `::warning title=Zero checks: ${check}::${message}` : `WARNING: ${message}`);
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const table = [
    '### Check coverage',
    '',
    `Workspace packages: **${packages.length}**`,
    '',
    '| Check | Packages defining it |',
    '|---|---|',
    ...rows.map(({ check, count }) => `| \`${check}\` | ${count === 0 ? '**0 — runs no checks**' : count} |`),
    '',
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
}
