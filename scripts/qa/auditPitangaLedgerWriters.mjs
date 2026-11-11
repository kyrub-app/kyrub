/**
 * Read-only repository-wide discovery aid for global reward-ledger access.
 * Run with: node scripts/qa/auditPitangaLedgerWriters.mjs
 * This is a lexical inventory, NOT a proof that dynamic Firestore paths are absent.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0').filter(path => /^(api|server|scripts|src)\/.+\.(?:ts|tsx|js|mjs|cjs)$/.test(path));
const patterns = [
  /rewardLedger/i,
  /rewardRedemptions/i,
  /rewardVouchers/i,
  /pitangaBalance/i,
  /deltaKCoins/i,
  /kyrubKCoinBalance/i,
  /persistKyrubRedemptionAtomically/i,
  /applyPitanga(?:Earn|Spend|XpConversion)InTransaction/i,
  /issuePitangaVoucherInTransaction/i,
  /buildPitangaMigrationSnapshot/i,
  /verifyPitangaMigrationCheckpoint/i,
  /rewardAudit/i,
  /pitangaXpConversions/i,
];
const hits = [];
const callsiteNames = 'persistKyrubRedemptionAtomically|applyPitangaEarnInTransaction|applyPitangaSpendInTransaction|applyPitangaXpConversionInTransaction|issuePitangaVoucherInTransaction|bootstrapVerifiedPitangaBalanceInTransaction|assertLegacyPitangaWriterAllowedInTransaction';
const callsitePattern = new RegExp(`\\b(?:${callsiteNames})\\s*\\(`, 'g');
const declarationPattern = new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+function|function|(?:const|let|var)\\s+(?:${callsiteNames})\\s*=)`);
const callsites = [];
const firestoreMutationPatterns = [
  /\b(?:transaction|batch|adminDb|db)\s*\.\s*(?:create|set|update|delete|add)\s*\(/,
  /\b(?:transaction|batch)\s*\.\s*(?:create|set|update|delete)\s*\(/,
  /\b(?:set|update|delete|add)\s*\(/,
];
const possibleMutations = [];
for (const path of tracked) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (patterns.some(pattern => pattern.test(lines[index]))) {
      hits.push({ path, line: index + 1, excerpt: lines[index].trim().slice(0, 240) });
    }
    if (firestoreMutationPatterns.some(pattern => pattern.test(lines[index])) &&
        /(?:gamification|reward|challenge|pitanga|coin)/i.test(path)) {
      possibleMutations.push({ path, line: index + 1,
        excerpt: lines[index].trim().slice(0, 240) });
    }
    // Exclude declarations by the target symbol name, not every const assignment:
    // `const result = await applyPitangaEarnInTransaction(...)` is a callsite.
    callsitePattern.lastIndex = 0;
    if (callsitePattern.test(lines[index]) && !declarationPattern.test(lines[index])) {
      callsites.push({ path, line: index + 1, excerpt: lines[index].trim().slice(0, 240) });
    }
  }
}
console.log(JSON.stringify({
  schemaVersion: 1,
  scope: 'tracked api/server/scripts/src JS/TS files',
  filesScanned: tracked.length,
  hits,
  possibleCallsites: callsites,
  possibleMutations,
  caveat: 'Lexical discovery only. Mutation matches include unrelated writes and false positives. Dynamic paths, aliases, generated code, external workers and Admin SDK writes require manual review.',
}, null, 2));
