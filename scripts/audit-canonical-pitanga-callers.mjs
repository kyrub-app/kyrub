#!/usr/bin/env node
/**
 * Fail-closed static audit for canonical Pitanga mutation call sites.
 * This is a repository guard, NOT proof of deployed/external writer coverage.
 */
import { execFileSync } from 'node:child_process';

const roots = /^(api|server|src|functions)\//;
const extensions = /\.(?:ts|tsx|js|mjs|cjs)$/;
const primitiveCalls = [
  'applyPitangaEarnInTransaction',
  'settleAcceptedSeedInTransaction',
  'applyPitangaSpendInTransaction',
  'applyPitangaXpConversionInTransaction',
  'issuePitangaVoucherInTransaction',
];
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0').filter(p => roots.test(p) && extensions.test(p));
const issues = [];
const usages = [];
for (const path of tracked) {
  const source = execFileSync('git', ['show', ':' + path], { encoding: 'utf8' });
  for (const primitive of primitiveCalls) {
    const re = new RegExp('\\b' + primitive + '\\s*\\(', 'g');
    let match;
    while ((match = re.exec(source))) {
      const line = source.slice(0, match.index).split('\n').length;
      const prefix = source.slice(Math.max(0, match.index - 40), match.index);
      if (/export\s+const\s*$/.test(prefix) || /function\s*$/.test(prefix)) continue;
      // The primitive may be called by a verified provenance wrapper, which
      // must be reviewed separately. No inference from optional flags.
      usages.push({ path, line, primitive });
      // A textual mention of legacyFenceRef (including comments) does NOT
      // prove that the caller passes a live fence or that deployed writers obey it.
      // Every call remains unclassified until a separate reviewed manifest
      // identifies its authority, deployment and transaction boundary.
      issues.push({ path, line, primitive, reason: 'Call site requires independently reviewed writer classification and deployed fence proof' });
    }
  }
}
console.log(JSON.stringify({
  scope: 'tracked repository sources only',
  deployedWritersVerified: false,
  externalWritersVerified: false,
  usages,
  issues,
}, null, 2));
if (issues.length) {
  console.error('BLOCKED: canonical writer calls require classification before release');
  process.exitCode = 1;
}
