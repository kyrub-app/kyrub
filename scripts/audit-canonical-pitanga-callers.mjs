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
const manifest=JSON.parse(execFileSync('git',['show',':scripts/pitanga-canonical-callsite-review.json'],{encoding:'utf8'}));
if(manifest.schemaVersion!==1||!Array.isArray(manifest.entries))throw Error('INVALID_SOURCE_REVIEW_MANIFEST');
const issues = [];
const sourceReview = [];
const matched = new Set();
const usages = [];
for (const path of tracked) {
  const source = execFileSync('git', ['show', ':' + path], { encoding: 'utf8' });
  let blobSha;
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
      blobSha??=execFileSync('git',['rev-parse',':'+path],{encoding:'utf8'}).trim();
      const entry=manifest.entries.find(e=>e.path===path&&e.line===line&&e.primitive===primitive&&e.blobSha===blobSha);
      if(entry)matched.add(entry);
      sourceReview.push({path,line,primitive,blobSha,classification:entry?.classification??'unreviewed-or-changed',
        observation:entry?.observation??null,deploymentVerified:false});
      // A textual mention of legacyFenceRef (including comments) does NOT
      // prove that the caller passes a live fence or that deployed writers obey it.
      // Every call remains unclassified until a separate reviewed manifest
      // identifies its authority, deployment and transaction boundary.
      issues.push({ path, line, primitive, reason: 'Call site requires independently verified deployed fence proof; source observation alone cannot clear release' });
    }
  }
}
console.log(JSON.stringify({
  scope: 'tracked repository sources only',
  deployedWritersVerified: false,
  externalWritersVerified: false,
  usages,
  sourceReview,
  sourceReviewSummary:{
    reviewed:sourceReview.filter(e=>e.classification!=='unreviewed-or-changed').length,
    unreviewed:sourceReview.filter(e=>e.classification==='unreviewed-or-changed').length,
    staleManifestEntries:manifest.entries.filter(e=>!matched.has(e)),
  },
  issues,
}, null, 2));
if (issues.length) {
  console.error('BLOCKED: canonical writer calls require classification before release');
  process.exitCode = 1;
}
