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
];
const hits = [];
for (const path of tracked) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (patterns.some(pattern => pattern.test(lines[index]))) {
      hits.push({ path, line: index + 1, excerpt: lines[index].trim().slice(0, 240) });
    }
  }
}
console.log(JSON.stringify({
  schemaVersion: 1,
  scope: 'tracked api/server/scripts/src JS/TS files',
  filesScanned: tracked.length,
  hits,
  caveat: 'Lexical discovery only. Dynamic paths, aliases, generated code, external workers and Admin SDK writes require manual review.',
}, null, 2));
