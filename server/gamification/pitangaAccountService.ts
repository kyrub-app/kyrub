import type { Firestore } from 'firebase-admin/firestore';
import { kyrubKCoinBalance, kyrubXpTotal, type KyrubRewardLedgerEntry, type KyrubXpEntry } from '../../shared/gamification.js';
import { applyCleanBaselineVerifiedXpConversionInTransaction } from './cleanBaselineVerifiedXpConversion.js';
import { applyVerifiedPitangaXpConversionInTransaction } from './pitangaVerifiedXpConversion.js';

const assertUid = (uid: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw Error('PITANGA_USER_INVALID');
};

/** Consistent, user-scoped statement. Never repairs or initializes economic state. */
export async function readPitangaAccount(db: Firestore, uid: string) {
  assertUid(uid);
  const root = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    const [balance, rewards, xp] = await Promise.all([
      tx.get(root.collection('pitangaBalance').doc('balance')),
      tx.get(root.collection('rewardLedger')), tx.get(root.collection('xpLedger')),
    ]);
    const entries = rewards.docs.map(doc => {
      const entry = doc.data() as KyrubRewardLedgerEntry & { economy?: string };
      if (entry.userId !== uid || entry.id !== doc.id || entry.economy !== 'k_coin') throw Error('PITANGA_LEDGER_SCOPE_INVALID');
      return entry;
    });
    const xpEntries = xp.docs.map(doc => {
      const entry = doc.data() as KyrubXpEntry & { economy?: string };
      if (entry.userId !== uid || entry.id !== doc.id || entry.economy !== 'kyrub_xp' || !Number.isFinite(Date.parse(entry.occurredAt))) throw Error('XP_LEDGER_SCOPE_INVALID');
      return entry;
    });
    const pitangas = kyrubKCoinBalance(entries);
    if (balance.exists && (balance.data()?.userId !== uid || balance.data()?.availableKCoins !== pitangas)) {
      throw Error('PITANGA_BALANCE_LEDGER_MISMATCH');
    }
    return { pitangas, xp: kyrubXpTotal(xpEntries),
      initialized: balance.exists,
      entries: [...entries.map(e => ({ id: e.id, unit: 'pitanga', delta: e.deltaKCoins, occurredAt: e.occurredAt })),
        ...xpEntries.map(e => ({ id: e.id, unit: 'xp', delta: e.deltaXp, occurredAt: e.occurredAt }))]
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id)),
    };
  });
}

/** UID comes only from verified auth; paths, time and authority are server owned. */
export async function convertPitangaAccount(db: Firestore, uid: string, input: { requestId: string; requestedXp: number }) {
  assertUid(uid);
  if (process.env.KYRUB_PITANGA_XP_CONVERSION_ENABLED !== 'true') throw Error('PITANGA_CONVERSION_DISABLED');
  const expectedProject = process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID?.trim();
  const expectedEpoch = process.env.KYRUB_PITANGA_WELCOME_FENCE_EPOCH?.trim();
  // The Admin SDK exposes this runtime getter; its bundled Firestore declaration
  // omits it. Never infer the actual target from an environment variable alone.
  const actualProject = (db as Firestore & { readonly projectId?: string }).projectId;
  if (!expectedProject || actualProject !== expectedProject || !expectedEpoch || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedEpoch)) {
    throw Error('PITANGA_CONVERSION_NOT_CONFIGURED');
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId) || !Number.isSafeInteger(input.requestedXp) || input.requestedXp < 1 ||
      !Number.isSafeInteger(input.requestedXp * 1000)) throw Error('PITANGA_CONVERSION_INPUT_INVALID');
  const root = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    const fence = await tx.get(db.doc('systemControl/pitangaLegacyWriterFence'));
    if (!fence.exists || fence.data()?.status !== 'fenced' || fence.data()?.writersVerified !== true || fence.data()?.epoch !== expectedEpoch) {
      throw Error('PITANGA_CONVERSION_WRITERS_UNVERIFIED');
    }
    const balanceRef = root.collection('pitangaBalance').doc('balance');
    const projection = await tx.get(balanceRef);
    const common = { ...input, userId: uid, occurredAt: new Date().toISOString(), balanceRef,
      receiptRef: root.collection('pitangaXpConversions').doc(input.requestId),
      debitRef: root.collection('rewardLedger').doc(`conversion_${input.requestId}`),
      xpRef: root.collection('xpLedger').doc(`conversion_${input.requestId}`),
    };
    if (projection.data()?.initializedBy === 'verified_clean_baseline_welcome') {
      const firstLoginReceiptRef = root.collection('authEvents').doc('first_login_v1');
      const receipt = await tx.get(firstLoginReceiptRef);
      // The immutable lifecycle receipt retains timestamp precision. Its issuer,
      // ownership and provenance are revalidated by the existing transaction.
      return applyCleanBaselineVerifiedXpConversionInTransaction(tx, { ...common,
        firebaseCreatedAt: receipt.data()?.firebaseCreatedAt,
        firstLoginReceiptRef, welcomeAwardRef: root.collection('rewardLedger').doc('earn_first_login_welcome_v1'),
      });
    }
    return applyVerifiedPitangaXpConversionInTransaction(tx, { ...common,
      migrationReceiptRef: root.collection('pitangaMigration').doc('receipt'),
      fenceRef: db.doc('systemControl/pitangaLegacyWriterFence'),
    });
  });
}
