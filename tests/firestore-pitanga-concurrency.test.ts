import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { applyPitangaEarnInTransaction } from '../server/gamification/pitangaEarnTransaction.js';
import { applyPitangaSpendInTransaction } from '../server/gamification/pitangaSpendTransaction.js';
import { applyPitangaXpConversionInTransaction } from '../server/gamification/pitangaXpConversionTransaction.js';
import { inspectPitangaBalanceAuthority } from '../server/gamification/pitangaBalanceAuthorityInspection.js';
import { issuePitangaVoucherInTransaction } from '../server/gamification/pitangaVoucherIssuanceTransaction.js';
import { buildPitangaMigrationSnapshot } from '../server/gamification/pitangaMigrationSnapshot.js';
import { verifyPitangaMigrationCheckpoint } from '../server/gamification/pitangaMigrationCheckpointVerification.js';
import { bootstrapVerifiedPitangaBalanceInTransaction } from '../server/gamification/pitangaMigrationVerifiedBootstrap.js';
import { assertLegacyPitangaWriterAllowedInTransaction } from '../server/gamification/pitangaLegacyWriterFence.js';

test('Firestore Emulator serializes competing spend and XP conversion on one balance', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-race-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `race_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  await balanceRef.create({ userId, availableKCoins: 0, migrationEpoch: 'emulator_epoch1' });
  await db.runTransaction(tx => applyPitangaEarnInTransaction(tx, {
    userId, awardId: 'initial', sourceType: 'challenge', sourceId: 'challenge1',
    amount: 1000, occurredAt, balanceRef,
    ledgerRef: root.collection('rewardLedger').doc('earn_initial'),
  }));
  const spend = db.runTransaction(tx => applyPitangaSpendInTransaction(tx, {
    userId, spendId: 'reward1', sourceId: 'reward1', amount: 1000, occurredAt,
    balanceRef, debitRef: root.collection('rewardLedger').doc('spend_reward1'),
  }));
  const convert = db.runTransaction(tx => applyPitangaXpConversionInTransaction(tx, {
    userId, requestId: 'conversion1', requestedXp: 1, occurredAt, balanceRef,
    debitRef: root.collection('rewardLedger').doc('conversion_conversion1'),
    xpRef: root.collection('xpLedger').doc('conversion_conversion1'),
    receiptRef: root.collection('pitangaXpConversions').doc('conversion1'),
  }));
  const outcomes = await Promise.allSettled([spend, convert]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1,
    'exactly one competing debit must commit');
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 0);
  const ledger = await root.collection('rewardLedger').get();
  assert.equal(ledger.docs.filter(d => d.data().deltaKCoins < 0).length, 1);
  const xp = await root.collection('xpLedger').get();
  assert.equal(xp.size, outcomes[1].status === 'fulfilled' ? 1 : 0);
  const receipt = await root.collection('pitangaXpConversions').get();
  assert.equal(receipt.size, xp.size);
});

test('Firestore Emulator permits only one of two independent XP conversions', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-convert-race-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `convert_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  await balanceRef.create({ userId, availableKCoins: 1000, migrationEpoch: 'emulator_epoch1' });
  const convert = (requestId: string) => db.runTransaction(tx =>
    applyPitangaXpConversionInTransaction(tx, {
      userId, requestId, requestedXp: 1, occurredAt, balanceRef,
      debitRef: root.collection('rewardLedger').doc(`conversion_${requestId}`),
      xpRef: root.collection('xpLedger').doc(`conversion_${requestId}`),
      receiptRef: root.collection('pitangaXpConversions').doc(requestId),
    }));
  const outcomes = await Promise.allSettled([convert('requestA'), convert('requestB')]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 0);
  assert.equal((await root.collection('rewardLedger').get()).size, 1);
  assert.equal((await root.collection('xpLedger').get()).size, 1);
  assert.equal((await root.collection('pitangaXpConversions').get()).size, 1);
});

test('Firestore Emulator replays the same conversion without duplicating XP', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-replay-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `replay_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  await balanceRef.create({ userId, availableKCoins: 1000, migrationEpoch: 'emulator_epoch1' });
  const run = (requestedXp: number) => db.runTransaction(tx =>
    applyPitangaXpConversionInTransaction(tx, {
      userId, requestId: 'sameRequest', requestedXp, occurredAt, balanceRef,
      debitRef: root.collection('rewardLedger').doc('conversion_sameRequest'),
      xpRef: root.collection('xpLedger').doc('conversion_sameRequest'),
      receiptRef: root.collection('pitangaXpConversions').doc('sameRequest'),
    }));
  const first = await run(1);
  assert.equal(first.replay, false);
  const retry = await run(1);
  assert.equal(retry.replay, true);
  await assert.rejects(() => run(2), /CONVERSION_IDEMPOTENCY_CONFLICT/);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 0);
  assert.equal((await root.collection('rewardLedger').get()).size, 1);
  assert.equal((await root.collection('xpLedger').get()).size, 1);
  assert.equal((await root.collection('pitangaXpConversions').get()).size, 1);
  await balanceRef.delete();
  await assert.rejects(() => run(1), /CONVERSION_REPLAY_BALANCE_UNAVAILABLE/);
  assert.equal((await root.collection('xpLedger').get()).size, 1);
});

test('Firestore Emulator prevents two independent reward redemptions from double-spending', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-spend-race-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `spend_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  await balanceRef.create({ userId, availableKCoins: 100, migrationEpoch: 'emulator_epoch1' });
  const spend = (spendId: string) => db.runTransaction(tx =>
    applyPitangaSpendInTransaction(tx, {
      userId, spendId, sourceId: spendId, amount: 100, occurredAt,
      balanceRef, debitRef: root.collection('rewardLedger').doc(`spend_${spendId}`),
    }));
  const outcomes = await Promise.allSettled([spend('rewardA'), spend('rewardB')]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 0);
  const ledger = await root.collection('rewardLedger').get();
  assert.equal(ledger.size, 1);
  assert.equal(ledger.docs[0].data().deltaKCoins, -100);
  assert.equal((await root.collection('xpLedger').get()).size, 0);
});

test('Firestore Emulator serializes an earn racing with a spend on the same balance', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-earn-spend-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `earnspend_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  await balanceRef.create({ userId, availableKCoins: 50, migrationEpoch: 'emulator_epoch1' });
  const earn = db.runTransaction(tx => applyPitangaEarnInTransaction(tx, {
    userId, awardId: 'second', sourceType: 'challenge', sourceId: 'challenge2',
    amount: 50, occurredAt, balanceRef,
    ledgerRef: root.collection('rewardLedger').doc('earn_second'),
  }));
  const spend = db.runTransaction(tx => applyPitangaSpendInTransaction(tx, {
    userId, spendId: 'reward50', sourceId: 'reward50',
    amount: 50, occurredAt, balanceRef,
    debitRef: root.collection('rewardLedger').doc('spend_reward50'),
  }));
  const outcomes = await Promise.allSettled([earn, spend]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 2);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 50);
  const ledger = await root.collection('rewardLedger').get();
  assert.equal(ledger.size, 2);
  assert.deepEqual(ledger.docs.map(doc => doc.data().deltaKCoins).sort((a, b) => a - b), [-50, 50]);
});

test('Firestore Emulator reconciles complete earning, spending and conversion history', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-ledger-reconcile-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `reconcile_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  // Zero is an explicitly empty test fixture, not a production migration strategy.
  await balanceRef.create({ userId, availableKCoins: 0, migrationEpoch: 'emulator_epoch1' });
  await db.runTransaction(tx => applyPitangaEarnInTransaction(tx, {
    userId, awardId: 'seed', sourceType: 'challenge', sourceId: 'challenge1',
    amount: 1175, occurredAt, balanceRef,
    ledgerRef: root.collection('rewardLedger').doc('earn_seed'),
  }));
  await db.runTransaction(tx => applyPitangaSpendInTransaction(tx, {
    userId, spendId: 'reward1', sourceId: 'reward1', amount: 75,
    occurredAt: '2026-11-11T12:01:00Z', balanceRef,
    debitRef: root.collection('rewardLedger').doc('spend_reward1'),
  }));
  await db.runTransaction(tx => applyPitangaXpConversionInTransaction(tx, {
    userId, requestId: 'convert1', requestedXp: 1,
    occurredAt: '2026-11-11T12:02:00Z', balanceRef,
    debitRef: root.collection('rewardLedger').doc('conversion_convert1'),
    xpRef: root.collection('xpLedger').doc('conversion_convert1'),
    receiptRef: root.collection('pitangaXpConversions').doc('convert1'),
  }));
  const inspection = await inspectPitangaBalanceAuthority(db, userId);
  assert.equal(inspection.status, 'consistent');
  assert.equal(inspection.ledgerBalance, 100);
  assert.equal(inspection.entryCount, 3);
  assert.equal((await root.collection('xpLedger').get()).size, 1);
  // The snapshot is read-only evidence; test fixtures explicitly satisfy the
  // completeness/fence inputs. This is NOT proof of a production write fence.
  const historical = await root.collection('rewardLedger').get();
  const checkpoint = buildPitangaMigrationSnapshot({
    userId,
    ledgerDocuments: historical.docs.map(doc => ({
      id: doc.id, data: doc.data() as never,
    })),
    completeLedgerVerified: true,
    legacyWritersFenced: true,
    existingProjection: {
      userId, availableKCoins: (await balanceRef.get()).data()?.availableKCoins,
    },
  });
  assert.equal(checkpoint.balance, 100);
  assert.equal(checkpoint.entryCount, 3);
  assert.match(checkpoint.ledgerSha256, /^[a-f0-9]{64}$/);
  const verifyCheckpoint = async () => {
    const fresh = await root.collection('rewardLedger').get();
    const projection = await balanceRef.get();
    return verifyPitangaMigrationCheckpoint({
      checkpoint,
      ledgerDocuments: fresh.docs.map(doc => ({
        id: doc.id, data: doc.data() as never,
      })),
      completeLedgerVerified: true,
      legacyWritersFenced: true,
      existingProjection: {
        userId, availableKCoins: projection.data()?.availableKCoins,
      },
    });
  };
  assert.equal((await verifyCheckpoint()).verified, true);
    // An out-of-band balance mutation must be detected, never silently adopted.
  await balanceRef.update({ availableKCoins: 101 });
  const divergent = await inspectPitangaBalanceAuthority(db, userId);
  assert.equal(divergent.status, 'inconsistent');
  assert.equal(divergent.ledgerBalance, 100);
  assert.equal(divergent.projectedBalance, 101);
  assert.throws(() => buildPitangaMigrationSnapshot({
    userId,
    ledgerDocuments: historical.docs.map(doc => ({
      id: doc.id, data: doc.data() as never,
    })),
    completeLedgerVerified: true,
    legacyWritersFenced: true,
    existingProjection: { userId, availableKCoins: 101 },
  }), /PITANGA_MIGRATION_PROJECTION_CONFLICT/);
  // A historical ledger mutation with an unchanged projection must also
  // invalidate the checkpoint. Never silently trust a stale migration digest.
  await balanceRef.update({ availableKCoins: 100 });
  const earnedDoc = root.collection('rewardLedger').doc('earn_seed');
  await earnedDoc.update({ deltaKCoins: 1176 });
  const changedLedger = await root.collection('rewardLedger').get();
  assert.throws(() => buildPitangaMigrationSnapshot({
    userId,
    ledgerDocuments: changedLedger.docs.map(doc => ({
      id: doc.id, data: doc.data() as never,
    })),
    completeLedgerVerified: true,
    legacyWritersFenced: true,
    existingProjection: { userId, availableKCoins: 100 },
  }), /PITANGA_MIGRATION_PROJECTION_CONFLICT/);
  const changedDigest = buildPitangaMigrationSnapshot({
    userId,
    ledgerDocuments: changedLedger.docs.map(doc => ({
      id: doc.id, data: doc.data() as never,
    })),
    completeLedgerVerified: true,
    legacyWritersFenced: true,
  });
  assert.notEqual(changedDigest.ledgerSha256, checkpoint.ledgerSha256);
  await assert.rejects(verifyCheckpoint(), /PITANGA_MIGRATION_PROJECTION_CONFLICT/);
  await balanceRef.update({ availableKCoins: 101 });
  await assert.rejects(verifyCheckpoint(), /PITANGA_CHECKPOINT_STALE/);

});

test('Firestore Emulator serializes voucher issuance against XP conversion', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-voucher-race-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `voucher_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  await balanceRef.create({ userId, availableKCoins: 1000, migrationEpoch: 'emulator_epoch1' });
  const redemptionId = `redemption_${userId}_order1`;
  const plan = {
    redemptionId, userId, rewardId: 'gift1',
    voucherCode: 'KRB-GIFT1-ORDER1', validUntil: '2026-12-11T12:00:00Z',
    debitEntry: {
      id: `${redemptionId}_debit`, userId, type: 'redeem' as const,
      deltaKCoins: -1000, sourceType: 'reward_redemption' as const,
      sourceId: 'gift1', correlationId: 'corr1', idempotencyKey: 'redeem:order1', occurredAt,
    },
    auditEvent: { type: 'reward_redemption_planned' as const, correlationId: 'corr1', idempotencyKey: 'order1' },
  };
  const voucher = () => db.runTransaction(tx => issuePitangaVoucherInTransaction(tx, {
    plan, balanceRef,
    redemptionRef: root.collection('rewardRedemptions').doc(redemptionId),
    voucherRef: root.collection('rewardVouchers').doc(redemptionId),
    debitRef: root.collection('rewardLedger').doc(`${redemptionId}_debit`),
    auditRef: root.collection('rewardAudit').doc(redemptionId),
  }));
  const convert = () => db.runTransaction(tx => applyPitangaXpConversionInTransaction(tx, {
    userId, requestId: 'convert1', requestedXp: 1, occurredAt, balanceRef,
    debitRef: root.collection('rewardLedger').doc('conversion_convert1'),
    xpRef: root.collection('xpLedger').doc('conversion_convert1'),
    receiptRef: root.collection('pitangaXpConversions').doc('convert1'),
  }));
  const outcomes = await Promise.allSettled([voucher(), convert()]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(o => o.status === 'rejected').length, 1);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 0);
  const vouchers = await root.collection('rewardVouchers').get();
  const xp = await root.collection('xpLedger').get();
  assert.equal(vouchers.size + xp.size, 1);
  assert.equal((await root.collection('rewardRedemptions').get()).size, vouchers.size);
  assert.equal((await root.collection('rewardAudit').get()).size, vouchers.size);
  assert.equal((await root.collection('pitangaXpConversions').get()).size, xp.size);
  assert.equal((await root.collection('rewardLedger').get()).size, 1);
  if (vouchers.size) {
    const replay = await voucher();
    assert.equal(replay.replay, true);
    assert.equal((await root.collection('rewardLedger').get()).size, 1);
  }
});


test('Firestore Emulator prevents two independent vouchers spending the same Pitangas', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-two-vouchers-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `two_vouchers_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  await balanceRef.create({ userId, availableKCoins: 1000, migrationEpoch: 'emulator_epoch1' });
  const occurredAt = '2026-11-11T12:00:00Z';
  const redeem = (orderId: string) => {
    const redemptionId = `redemption_${userId}_${orderId}`;
    const plan = {
      redemptionId, userId, rewardId: 'gift1',
      voucherCode: `KRB-GIFT1-${orderId}`,
      validUntil: '2026-12-11T12:00:00Z',
      debitEntry: {
        id: `${redemptionId}_debit`, userId, type: 'redeem' as const,
        deltaKCoins: -1000, sourceType: 'reward_redemption' as const,
        sourceId: 'gift1', correlationId: orderId,
        idempotencyKey: `redeem:${orderId}`, occurredAt,
      },
      auditEvent: {
        type: 'reward_redemption_planned' as const,
        correlationId: orderId, idempotencyKey: orderId,
      },
    };
    return db.runTransaction(tx => issuePitangaVoucherInTransaction(tx, {
      plan, balanceRef,
      redemptionRef: root.collection('rewardRedemptions').doc(redemptionId),
      voucherRef: root.collection('rewardVouchers').doc(redemptionId),
      debitRef: root.collection('rewardLedger').doc(`${redemptionId}_debit`),
      auditRef: root.collection('rewardAudit').doc(redemptionId),
    }));
  };
  const outcomes = await Promise.allSettled([redeem('orderA'), redeem('orderB')]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(o => o.status === 'rejected').length, 1);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 0);
  assert.equal((await root.collection('rewardRedemptions').get()).size, 1);
  assert.equal((await root.collection('rewardVouchers').get()).size, 1);
  assert.equal((await root.collection('rewardLedger').get()).size, 1);
  assert.equal((await root.collection('rewardAudit').get()).size, 1);
});

test('Firestore Emulator bootstraps historical balance once and rejects competing checkpoint', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-bootstrap-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `bootstrap_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const receiptRef = root.collection('pitangaMigration').doc('receipt');
  const fenceRef = db.doc('systemControl/pitangaLegacyWriterFence');
  await fenceRef.set({ status: 'fenced', epoch: userId, writersVerified: true });
  const historicalEntry = {
    id: 'earn_historical', userId, type: 'earn' as const,
    deltaKCoins: 1000, sourceType: 'challenge' as const,
    sourceId: 'challenge1', correlationId: 'historical1',
    idempotencyKey: 'historical1', occurredAt: '2026-11-11T12:00:00Z',
  };
  await root.collection('rewardLedger').doc(historicalEntry.id).create(historicalEntry);
  const historical = await root.collection('rewardLedger').get();
  const checkpoint = buildPitangaMigrationSnapshot({
    userId, ledgerDocuments: historical.docs.map(doc => ({
      id: doc.id, data: doc.data() as never,
    })),
    completeLedgerVerified: true, legacyWritersFenced: true,
  });
  const bootstrap = (cp = checkpoint) => db.runTransaction(tx =>
    bootstrapVerifiedPitangaBalanceInTransaction(tx, {
      checkpoint: cp, fenceEpoch: userId, balanceRef, receiptRef, fenceRef,
      ledgerRef: root.collection('rewardLedger'), legacyWritersFenced: true,
    }));
  const outcomes = await Promise.allSettled([bootstrap(), bootstrap()]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 2);
  assert.deepEqual(outcomes.filter(x => x.status === 'fulfilled')
    .map(x => (x as PromiseFulfilledResult<Awaited<ReturnType<typeof bootstrap>>>).value.replay)
    .sort(), [false, true]);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 1000);
  assert.equal((await receiptRef.get()).data()?.ledgerSha256, checkpoint.ledgerSha256);
  // The membership digest is persisted with the historical checkpoint.
  const receiptData = (await receiptRef.get()).data();
  assert.match(receiptData?.historicalMembershipSha256, /^[a-f0-9]{64}$/);
  assert.equal(receiptData?.entryCount, 1);
  assert.equal(receiptData?.balance, 1000);
  await assert.rejects(bootstrap({ ...checkpoint, ledgerSha256: 'b'.repeat(64) }),
    /PITANGA_CHECKPOINT_STALE/);
  // A late historical mutation is detected from the ledger read inside
  // the transaction, not from a stale caller-provided snapshot.
  await root.collection('rewardLedger').doc(historicalEntry.id).update({
    correlationId: 'tampered_after_checkpoint',
  });
  await assert.rejects(bootstrap(), /PITANGA_CHECKPOINT_STALE/);
  // Restore historical evidence to isolate the subsequent fence assertion.
  await root.collection('rewardLedger').doc(historicalEntry.id).update({
    correlationId: historicalEntry.correlationId,
  });
  await fenceRef.update({ status: 'open' });
  await assert.rejects(bootstrap(), /PITANGA_BOOTSTRAP_FENCE_UNVERIFIED/);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 1000);
});

test('Firestore Emulator prevents guarded legacy writes after the fence is committed', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-fence-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `fence_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const fenceRef = db.doc('systemControl/pitangaLegacyWriterFence');
  const ledgerRef = root.collection('rewardLedger').doc('earn_after_fence');
  await fenceRef.set({ status: 'open', epoch: userId });
  const guardedWrite = () => db.runTransaction(async tx => {
    await assertLegacyPitangaWriterAllowedInTransaction(tx, { fenceRef, expectedEpoch: userId });
    tx.create(ledgerRef, {
      id: ledgerRef.id, userId, type: 'earn', economy: 'k_coin',
      deltaKCoins: 1000, sourceType: 'challenge', sourceId: 'test',
      correlationId: 'guarded', idempotencyKey: 'guarded',
      occurredAt: '2026-11-11T12:00:00Z',
    });
  });
  await fenceRef.update({ status: 'fencing' });
  await assert.rejects(guardedWrite(), /PITANGA_LEGACY_WRITER_FENCED/);
  assert.equal((await ledgerRef.get()).exists, false);
  await fenceRef.update({ status: 'fenced', writersVerified: true });
  await assert.rejects(guardedWrite(), /PITANGA_LEGACY_WRITER_FENCED/);
  assert.equal((await ledgerRef.get()).exists, false);
});

test('Firestore Emulator serializes fence activation against a guarded legacy writer', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-fence-race-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `fence_race_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const fenceRef = db.doc('systemControl/pitangaLegacyWriterFence');
  const ledgerRef = root.collection('rewardLedger').doc('earn_race');
  await fenceRef.set({ status: 'open', epoch: userId });
  const legacyWrite = db.runTransaction(async tx => {
    await assertLegacyPitangaWriterAllowedInTransaction(tx, {
      fenceRef, expectedEpoch: userId,
    });
    tx.create(ledgerRef, {
      id: ledgerRef.id, userId, type: 'earn', economy: 'k_coin',
      deltaKCoins: 1000, sourceType: 'challenge', sourceId: 'challenge1',
      correlationId: 'race1', idempotencyKey: 'race1',
      occurredAt: '2026-11-11T12:00:00Z',
    });
  });
  const activateFence = db.runTransaction(async tx => {
    const current = await tx.get(fenceRef);
    assert.equal(current.data()?.status, 'open');
    tx.update(fenceRef, { status: 'fenced', writersVerified: true });
  });
  const results = await Promise.allSettled([legacyWrite, activateFence]);
  assert.equal(results[1].status, 'fulfilled', 'fence activation must commit');
  const recorded = await ledgerRef.get();
  const finalFence = await fenceRef.get();
  assert.equal(finalFence.data()?.status, 'fenced');
  if (results[0].status === 'rejected') {
    assert.match(String(results[0].reason), /PITANGA_LEGACY_WRITER_FENCED|ABORTED|conflict|transaction/i);
    assert.equal(recorded.exists, false);
  } else {
    assert.equal(recorded.exists, true, 'write may commit only before the fence');
  }
  await assert.rejects(db.runTransaction(async tx => {
    await assertLegacyPitangaWriterAllowedInTransaction(tx, {
      fenceRef, expectedEpoch: userId,
    });
    tx.create(root.collection('rewardLedger').doc('earn_late'), { userId });
  }), /PITANGA_LEGACY_WRITER_FENCED/);
  assert.equal((await root.collection('rewardLedger').doc('earn_late').get()).exists, false);
});
