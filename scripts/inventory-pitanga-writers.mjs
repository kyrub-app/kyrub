#!/usr/bin/env node
/**
 * Repository-wide static inventory of potential Pitanga writers.
 * Run: node scripts/inventory-pitanga-writers.mjs
 * This is a discovery aid, NOT proof that deployed writers are fenced.
 */
import { execFileSync } from 'node:child_process';

const pattern = [
  'availableKCoins', 'pitangaBalance', 'rewardLedger',
  'pitangaXpConversions', 'pitangaVouchers',
  'KCoins', 'pitangas', 'pitanga',
].join('|');

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean)
  .filter(path => /\.(ts|tsx|js|mjs|cjs)$/.test(path))
  .filter(path => /^(api|server|src|functions)\//.test(path));

const candidates = [];
const mutationPattern = /\b(setDoc|updateDoc|addDoc|deleteDoc|runTransaction|increment|applyPitanga|award|spend|convert|redeem|issue|credit|debit)\b|\btx\.(set|update|create|delete)\b|\.(set|update|create|delete)\s*\(/i;
for (const path of tracked) {
  let output = '';
  try {
    output = execFileSync('git', ['grep', '-n', '-I', '-i', '-E', pattern, '--', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    if (error.status === 1) continue;
    throw error;
  }
  const matches = output.trim().split('\n').filter(Boolean);
  if (!matches.length) continue;
  // Include neighboring lines: Firestore references and their mutations often span statements.
  const sourceLines = execFileSync('git', ['show', ':' + path], { encoding: 'utf8' }).split('\n');
  const mutationLineNumbers = new Set();
  for (const match of matches) {
    const lineNumber = Number(match.match(/:(\d+):/)?.[1]);
    if (!Number.isSafeInteger(lineNumber)) continue;
    for (let n = Math.max(1, lineNumber - 4); n <= Math.min(sourceLines.length, lineNumber + 4); n++) {
      if (mutationPattern.test(sourceLines[n - 1])) mutationLineNumbers.add(n);
    }
  }
  const mutation = [...mutationLineNumbers].sort((a, b) => a - b).map(n => `${path}:${n}:${sourceLines[n - 1].trim()}`);
  candidates.push({ path, hits: matches.length, mutationHints: mutation.length, lines: matches, mutations: mutation });
}
candidates.sort((a, b) => b.mutationHints - a.mutationHints || b.hits - a.hits || a.path.localeCompare(b.path));
console.log('# Pitanga writer candidates — tracked source inventory');
console.log('This scan identifies source references, not verified writers or deployed services.');
console.log('It cannot inspect external Cloud Functions, scheduled jobs, Firestore Admin credentials or production revisions.\\n');
console.log('Tracked application files scanned: ' + tracked.length);
console.log('Candidate files: ' + candidates.length + '\n');
for (const item of candidates) {
  console.log('## ' + item.path + ' (' + item.hits + ' references; ' + item.mutationHints + ' mutation hints)');
  for (const line of item.mutations) console.log('MUTATION_HINT ' + line);
  for (const line of item.lines) console.log(line);
}
console.log('\\nRELEASE GATE: independently classify each candidate, inventory external writers, verify the deployed revision and transactional fence before setting writersVerified=true.');
