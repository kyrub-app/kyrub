import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Discovery only: a lexical inventory cannot prove absence of dynamically
// constructed paths, deployed Admin SDK writers, imports or console edits.
const expected = new Map([
  ['server/gamification/xpLedgerRepository.ts','canonical writer'],
  ['server/gamification/firstStoreChallengeAwardTransaction.ts','first-store writer'],
  ['server/gamification/firstStorePublishedAwardTransaction.ts','first-publication writer'],
  ['server/gamification/pitangaXpConversionTransaction.ts','conversion writer'],
]);
const known = new Map([
  ['api/health.ts','authenticated own-ledger reader'],
  ['scripts/audit-canonical-pitanga-callers.mjs','read-only audit'],
  ['scripts/audit-cocar-writers.mjs','read-only audit'],
  ['server/gamification/cleanBaselineVerifiedXpConversion.ts','conversion adapter'],
  ['server/gamification/firstStoreChallengeAwardService.ts','first-store adapter'],
  ['server/gamification/firstStorePublicationAuthority.ts','publication adapter/replay reader'],
  ['server/gamification/pitangaAccountService.ts','account reader/conversion adapter'],
  ['server/gamification/pitangaEarnTransaction.ts','Pitanga writer excludes XP references'],
  ['server/gamification/pitangaSpendTransaction.ts','Pitanga writer excludes XP references'],
  ['shared/gamificationEconomies.ts','economy type contract'],
  ['server/gamification/cocarProjectionTransaction.ts','candidate projection/rebuild'],
  ['server/gamification/pitangaXpConversionService.ts','conversion adapter'],
  ['server/gamification/pitangaVerifiedXpConversion.ts','conversion adapter'],
  ['server/gamification/firstStorePublishedVerificationService.ts','publication adapter'],
  ['server/payments/officialPlanPixCheckout.ts','canonical writer caller'],
  ['server/freelance/freelanceReputationIndexAudit.ts','publication reader'],
  ['shared/gamification.ts','ledger contract'],
  ['shared/cocarProjection.ts','projection contract'],
]);
const files = execFileSync('git',['ls-files','-z'],{encoding:'utf8',maxBuffer:32*1024*1024}).split('\0').filter(Boolean);
const marker = /xpLedger|deltaXp|kyrub_xp|persistVerifiedKyrubXp|cocarProjectionV1|prepareCocarProjectionForNewXp|awardVerifiedFirstStore(?:Challenge|Publication)InTransaction|apply(?:Verified)?PitangaXpConversionInTransaction/;
const source = /\.(?:[cm]?[jt]sx?|py|go|java|kt|rb|php|sh|rules|ya?ml|json|sql|tf|bicep)$/i;
const matches = [];
for (const path of files) {
  if (!source.test(path) || /(?:^|\/)(?:node_modules|dist|coverage|vendor)(?:\/|$)/.test(path) || /(?:^|\/)(?:package-lock|pnpm-lock|yarn\.lock)/.test(path)) continue;
  const content=readFileSync(path,'utf8');
  const lines=content.split(/\r?\n/);
  const hits=lines.flatMap((line,i)=>marker.test(line)?[{line:i+1,markers:[...new Set(line.match(new RegExp(marker.source,'g')))]}]:[]);
  if(!hits.length)continue;
  const classification=expected.get(path) ?? known.get(path) ?? (/^(?:tests\/|test\/|__tests__\/)/.test(path)?'test/fixture':path.endsWith('.rules')?'rules review':'REVIEW REQUIRED');
  matches.push({path,classification,hits});
}
const absent=[...expected.keys()].filter(path=>!matches.some(m=>m.path===path));
const unintegrated=[...expected.keys()].filter(path=>!readFileSync(path,'utf8').includes('prepareCocarProjectionForNewXp('));
const review=matches.filter(m=>m.classification==='REVIEW REQUIRED'||m.classification==='rules review');
console.log(JSON.stringify({scannedTrackedPaths:files.length,matchedFiles:matches.length,expectedDirectWriters:expected.size,absent,unintegrated,reviewRequired:review.length,matches,productionCoverageCertified:false},null,2));
if(absent.length||unintegrated.length||review.length)process.exitCode=1;
