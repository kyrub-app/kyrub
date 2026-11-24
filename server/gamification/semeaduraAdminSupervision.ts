import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { kyrubKCoinBalance, type KyrubRewardLedgerEntry } from '../../shared/gamification.js';
import { calculatePitangueiraJourney } from '../../shared/pitangueiraJourney.js';
import { semeaduraEconomicPilotEnabled } from './semeaduraEconomicPilot.js';

const uid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const LIMIT = 200;

/** Authenticated account-scoped administrative read, only in disposable
 * Auth/Firestore emulators. No HTTP route, global scan, client SDK access
 * or mutation. Gross credits/debits are not synonymous with issuance/spend. */
export async function readIsolatedGamificationAccountSupervision(
  db: Firestore, auth: Auth, authorization: string, targetUid: string,
) {
  if (!semeaduraEconomicPilotEnabled(db) || auth.app.options.projectId !== 'demo-kyrub-welcome')
    throw Error('GAMIFICATION_SUPERVISION_DISABLED');
  if (!uid(targetUid)) throw Error('GAMIFICATION_SUPERVISION_INPUT_INVALID');
  const token = typeof authorization === 'string' && /^Bearer (\S+)$/.exec(authorization)?.[1];
  if (!token) throw Error('GAMIFICATION_SUPERVISION_AUTH_REQUIRED');
  let reviewerId: string;
  try {
    const identity = await auth.verifyIdToken(token, true);
    if (!uid(identity.uid) || identity.aud !== 'demo-kyrub-welcome' ||
        !Number.isFinite(identity.exp) || identity.exp <= Date.now()/1000)
      throw Error('INVALID_SESSION');
    reviewerId = identity.uid;
  } catch {
    throw Error('GAMIFICATION_SUPERVISION_AUTH_REQUIRED');
  }
  const root = db.collection('users').doc(targetUid);
  return db.runTransaction(async tx => {
    const [admin, reviewer] = await Promise.all([
      tx.get(db.doc('kyrub_admin/control_plane/admins/'+reviewerId)),
      tx.get(db.doc('systemControl/semeaduraEconomicReview/reviewers/'+reviewerId)),
    ]);
    if (admin.get('uid') !== reviewerId || admin.get('role') !== 'super_admin' ||
        admin.get('status') !== 'active' || reviewer.get('schemaVersion') !== 1 ||
        reviewer.get('reviewerId') !== reviewerId || reviewer.get('active') !== true ||
        reviewer.get('fixtureOnly') !== true)
      throw Error('GAMIFICATION_SUPERVISION_FORBIDDEN');
    const [balance, ledger, progress] = await Promise.all([
      tx.get(root.collection('pitangaBalance').doc('balance')),
      tx.get(root.collection('rewardLedger').limit(LIMIT+1)),
      tx.get(root.collection('semeaduraProgress').doc('summary')),
    ]);
    const findings: string[] = [];
    let economy: {credits:number;debits:number;balance:number}|null = null;
    const coverage = ledger.size > LIMIT ? 'partial' : 'complete';
    if (coverage === 'complete' && (balance.exists || ledger.size > 0)) {
      try {
        const entries = ledger.docs.map(doc => {
          const entry = doc.data() as KyrubRewardLedgerEntry & {economy?:string};
          if (entry.userId !== targetUid || entry.id !== doc.id || entry.economy !== 'k_coin')
            throw Error('LEDGER_SCOPE');
          return entry;
        });
        const net = kyrubKCoinBalance(entries);
        if (!balance.exists || balance.get('userId') !== targetUid || balance.get('availableKCoins') !== net)
          throw Error('BALANCE_MISMATCH');
        let credits = 0, debits = 0;
        for (const entry of entries) {
          if (entry.deltaKCoins > 0) credits += entry.deltaKCoins;
          else debits -= entry.deltaKCoins;
          if (!Number.isSafeInteger(credits) || !Number.isSafeInteger(debits)) throw Error('OVERFLOW');
        }
        economy = {credits,debits,balance:net};
      } catch {
        findings.push('PITANGA_LEDGER_OR_BALANCE_INVALID');
      }
    }
    let journey: {seeds:number;pitangueiras:number;bosques:number}|null = null;
    if (progress.exists) {
      const data = progress.data()!;
      if (data.authorId !== targetUid || !Number.isSafeInteger(data.acceptedSeeds) ||
          data.acceptedSeeds < 0 || data.pitangueiras !== Math.floor(data.acceptedSeeds/1000)) {
        findings.push('SEMEADURA_PROJECTION_INVALID');
      } else {
        const calculated=calculatePitangueiraJourney(data.acceptedSeeds);
        journey={seeds:calculated.totalSeeds,pitangueiras:calculated.pitangueiras,bosques:calculated.bosques};
      }
    }
    return {scope:'single-account' as const, environment:'isolated-emulator' as const,
      ledgerCoverage:coverage, observedEntries:ledger.size, economy, journey,
      journeySource:'author-projection-not-receipt-reconciliation' as const, findings};
  },{readOnly:true});
}
