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
      const surrounding = source.slice(match.index, match.index + 1500);
      if (!surrounding.includes('legacyFenceRef') &&
          !/cleanBaselineVerified|pitangaVerified/i.test(path)) {
        issues.push({ path, line, primitive, reason: 'No legacyFenceRef at call site; manual classification required' });
      }
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
