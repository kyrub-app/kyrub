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
  await balanceRef.create({ userId, availableKCoins: 0 });
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
  await balanceRef.create({ userId, availableKCoins: 1000 });
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
  await balanceRef.create({ userId, availableKCoins: 1000 });
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
  await balanceRef.create({ userId, availableKCoins: 100 });
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
  await balanceRef.create({ userId, availableKCoins: 50 });
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
  await balanceRef.create({ userId, availableKCoins: 0 });
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
    // An out-of-band balance mutation must be detected, never silently adopted.
  await balanceRef.update({ availableKCoins: 101 });
  const divergent = await inspectPitangaBalanceAuthority(db, userId);
  assert.equal(divergent.status, 'inconsistent');
  assert.equal(divergent.ledgerBalance, 100);
  assert.equal(divergent.projectedBalance, 101);
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
  await balanceRef.create({ userId, availableKCoins: 1000 });
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
  await balanceRef.create({ userId, availableKCoins: 1000 });
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
