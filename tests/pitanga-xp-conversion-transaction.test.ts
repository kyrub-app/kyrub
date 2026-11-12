import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPitangaXpConversionInTransaction } from '../server/gamification/pitangaXpConversionTransaction.js';

const ref = (kind: string) => {
  const collection = kind === 'debit' ? 'rewardLedger'
    : kind === 'xp' ? 'xpLedger'
    : kind === 'receipt' ? 'pitangaXpConversions' : 'pitangaBalance';
  const id = kind === 'debit' || kind === 'xp' ? 'conversion_req1'
    : kind === 'receipt' ? 'req1' : 'balance';
  const path = `users/user1/${collection}/${id}`;
  return { id, path, parent: { path: `users/user1/${collection}` } };
};
const makeTx = (balance: number, replay = false) => {
  const refs = { balanceRef: ref('balance'), debitRef: ref('debit'), xpRef: ref('xp'), receiptRef: ref('receipt') };
  const snapshots = new Map<string, Record<string, unknown>>([
    [refs.balanceRef.path, { userId: 'user1', migrationEpoch: 'epoch1', availableKCoins: balance }],
  ]);
  if (replay) {
    snapshots.set(refs.receiptRef.path, { userId: 'user1', requestId: 'req1', requestedXp: 1, availablePitangasBefore: 1000, status: 'committed', occurredAt: '2026-11-11T12:00:00Z' });
    snapshots.set(refs.debitRef.path, { id: refs.debitRef.id, userId: 'user1', idempotencyKey: 'pitanga_xp_req1', type: 'redeem', economy: 'k_coin', sourceType: 'conversion', sourceId: 'req1', correlationId: 'req1', occurredAt: '2026-11-11T12:00:00Z', deltaKCoins: -1000 });
    snapshots.set(refs.xpRef.path, { id: refs.xpRef.id, userId: 'user1', idempotencyKey: 'pitanga_xp_req1', economy: 'kyrub_xp', sourceType: 'conversion', sourceId: 'req1', correlationId: 'req1', occurredAt: '2026-11-11T12:00:00Z', deltaXp: 1 });
  }
  const writes: Array<{ op: string; path: string; id: string; value: Record<string, unknown> }> = [];
  const tx = {
    get: async (r: { path: string }) => ({
      exists: snapshots.has(r.path), data: () => snapshots.get(r.path),
    }),
    create: (r: { path: string; id: string }, value: Record<string, unknown>) => { writes.push({ op: 'create', path: r.path, id: r.id, value }); },
    update: (r: { path: string; id: string }, value: Record<string, unknown>) => { writes.push({ op: 'update', path: r.path, id: r.id, value }); },
  };
  return { refs, tx, writes };
};

test('stages balance update, debit, XP credit and receipt together', async () => {
  const { refs, tx, writes } = makeTx(1000);
  const result = await applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never);
  assert.deepEqual(result, { xpCredited: 1, pitangasDebited: 1000, remainingPitangas: 0, replay: false });
  assert.equal(writes.length, 4);
  assert.equal(writes.find(w => w.id === 'balance')?.value.availableKCoins, 0);
  assert.equal(writes.find(w => w.path.includes('/rewardLedger/'))?.value.deltaKCoins, -1000);
  assert.equal(writes.find(w => w.path.includes('/rewardLedger/'))?.value.economy, 'k_coin');
  assert.equal(writes.find(w => w.path.includes('/xpLedger/'))?.value.economy, 'kyrub_xp');
  assert.equal(writes.find(w => w.path.includes('/xpLedger/'))?.value.deltaXp, 1);
  assert.equal(writes.find(w => w.path.includes('/xpLedger/'))?.value.sourceType, 'conversion');
});

test('same request replay does not stage additional writes', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const result = await applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never);
  assert.equal(result.replay, true);
  assert.equal(writes.length, 0);
});

test('insufficient balance fails without writes', async () => {
  const { refs, tx, writes } = makeTx(999);
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /PITANGA_BALANCE_INSUFFICIENT/);
  assert.equal(writes.length, 0);
});

test('conflicting replay rejects', async () => {
  const { refs, tx } = makeTx(0, true);
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 2, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_IDEMPOTENCY_CONFLICT/);
});

test('missing authoritative balance fails closed', async () => {
  const { refs, tx, writes } = makeTx(1000);
  const missingBalanceTx = {
    ...tx,
    get: async (r: { id: string }) => r.id === 'balance'
      ? { exists: false, data: () => undefined }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(missingBalanceTx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_BALANCE_NOT_INITIALIZED/);
  assert.equal(writes.length, 0);
});

test('partial ledger state fails closed without additional writes', async () => {
  const { refs, tx, writes } = makeTx(1000);
  const partialTx = {
    ...tx,
    get: async (r: { id: string }) => r.path === refs.debitRef.path
      ? { exists: true, data: () => ({ deltaKCoins: -1000 }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(partialTx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_PARTIAL_STATE/);
  assert.equal(writes.length, 0);
});

test('inconsistent replay receipt fails closed', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const inconsistentTx = {
    ...tx,
    get: async (r: { id: string }) => r.path === refs.xpRef.path
      ? { exists: true, data: () => ({ deltaXp: 2 }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(inconsistentTx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_LEDGER_INCONSISTENT/);
  assert.equal(writes.length, 0);
});

test('replay with ledger belonging to another user is rejected', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const tampered = {
    ...tx,
    get: async (r: { id: string }) => r.path === refs.xpRef.path
      ? { exists: true, data: () => ({ id: 'conversion_req1', userId: 'other_user', idempotencyKey: 'pitanga_xp_req1', sourceType: 'conversion', deltaXp: 1 }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tampered as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_LEDGER_INCONSISTENT/);
  assert.equal(writes.length, 0);
});

test('invalid XP amount fails before any transaction reads', async () => {
  const { refs, writes } = makeTx(1000);
  let reads = 0;
  const tx = { get: async () => { reads++; throw new Error('SHOULD_NOT_READ'); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 0, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /XP_CONVERSION_AMOUNT_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});

test('2075 Pitangas convert to 2 XP with 75 remaining', async () => {
  const { refs, tx, writes } = makeTx(2075);
  const result = await applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 2, occurredAt: '2026-11-11T12:00:00Z',
  } as never);
  assert.deepEqual(result, { xpCredited: 2, pitangasDebited: 2000, remainingPitangas: 75, replay: false });
  assert.equal(writes.find(w => w.id === 'balance')?.value.availableKCoins, 75);
  assert.equal(writes.find(w => w.path.includes('/rewardLedger/'))?.value.deltaKCoins, -2000);
  assert.equal(writes.find(w => w.path.includes('/xpLedger/'))?.value.deltaXp, 2);
});

test('unsafe XP conversion multiplication fails before transaction reads', async () => {
  const { refs } = makeTx(1000);
  let reads = 0;
  const tx = { get: async () => { reads++; throw new Error('SHOULD_NOT_READ'); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: Number.MAX_SAFE_INTEGER, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /XP_CONVERSION_OVERFLOW/);
  assert.equal(reads, 0);
});

test('replay with mismatched correlation fails closed', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const mismatched = {
    ...tx,
    get: async (r: { id: string }) => r.path === refs.debitRef.path
      ? { exists: true, data: () => ({
          id: 'conversion_req1', userId: 'user1', idempotencyKey: 'pitanga_xp_req1',
          type: 'redeem', sourceType: 'conversion', sourceId: 'req1',
          correlationId: 'another_request', deltaKCoins: -1000,
        }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(mismatched as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_LEDGER_INCONSISTENT/);
  assert.equal(writes.length, 0);
});

test('replay with fresh retry timestamp uses original committed receipt', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const result = await applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:01Z',
  } as never);
  assert.equal(result.replay, true);
  assert.equal(writes.length, 0);
});

test('replay with XP ledger timestamp mismatch is rejected', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const mismatched = {
    ...tx,
    get: async (r: { id: string }) => r.path === refs.xpRef.path
      ? { exists: true, data: () => ({
          id: 'conversion_req1', userId: 'user1', idempotencyKey: 'pitanga_xp_req1',
          sourceType: 'conversion', sourceId: 'req1', correlationId: 'req1',
          occurredAt: '2026-11-11T12:00:01Z', deltaXp: 1,
        }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(mismatched as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_LEDGER_INCONSISTENT/);
  assert.equal(writes.length, 0);
});


test('replay rejects a debit belonging to another economy', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const tampered = {
    ...tx,
    get: async (r: { id: string }) => r.path === refs.debitRef.path
      ? { exists: true, data: () => ({
          id: 'conversion_req1', userId: 'user1', idempotencyKey: 'pitanga_xp_req1',
          type: 'redeem', economy: 'store_loyalty_points', sourceType: 'conversion',
          sourceId: 'req1', correlationId: 'req1', occurredAt: '2026-11-11T12:00:00Z', deltaKCoins: -1000,
        }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tampered as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:01Z',
  } as never), /CONVERSION_LEDGER_INCONSISTENT/);
  assert.equal(writes.length, 0);
});


test('replay rejects XP credited to an incorrect economy', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const tampered = {
    ...tx,
    get: async (r: { id: string }) => r.path === refs.xpRef.path
      ? { exists: true, data: () => ({
          id: 'conversion_req1', userId: 'user1', idempotencyKey: 'pitanga_xp_req1',
          economy: 'k_coin', sourceType: 'conversion', sourceId: 'req1',
          correlationId: 'req1', occurredAt: '2026-11-11T12:00:00Z', deltaXp: 1,
        }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tampered as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:01Z',
  } as never), /CONVERSION_LEDGER_INCONSISTENT/);
  assert.equal(writes.length, 0);
});


test('replay rejects tampered original balance in receipt', async () => {
  const { refs, tx, writes } = makeTx(0, true);
  const tampered = {
    ...tx,
    get: async (r: { id: string }) => r.path === refs.receiptRef.path
      ? { exists: true, data: () => ({
          userId: 'user1', requestId: 'req1', requestedXp: 1,
          availablePitangasBefore: 99, status: 'committed', occurredAt: '2026-11-11T12:00:00Z',
        }) }
      : tx.get(r),
  };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tampered as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:01Z',
  } as never), /PITANGA_BALANCE_INSUFFICIENT/);
  assert.equal(writes.length, 0);
});

test('conversion rejects a debit reference in another user account before reads', async () => {
  const { refs, tx, writes } = makeTx(1000);
  let reads = 0;
  const guardedTx = { ...tx, get: async (r: { id: string }) => { reads++; return tx.get(r); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(guardedTx as never, {
    ...refs,
    debitRef: { id: 'debit', path: 'users/user2/rewardLedger/debit',
      parent: { path: 'users/user2/rewardLedger' } },
    userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_REFERENCE_SCOPE_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});

test('conversion rejects a debit reference in store loyalty points before reads', async () => {
  const { refs, tx, writes } = makeTx(1000);
  let reads = 0;
  const guardedTx = { ...tx, get: async (r: { id: string }) => { reads++; return tx.get(r); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(guardedTx as never, {
    ...refs,
    debitRef: { id: 'debit', path: 'users/user1/storeLoyaltyPoints/debit',
      parent: { path: 'users/user1/storeLoyaltyPoints' } },
    userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_REFERENCE_SCOPE_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});

test('conversion rejects XP credit redirected into the Pitanga ledger', async () => {
  const { refs, tx, writes } = makeTx(1000);
  let reads = 0;
  const guardedTx = { ...tx, get: async (r: { id: string }) => { reads++; return tx.get(r); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(guardedTx as never, {
    ...refs,
    xpRef: { id: 'xp', path: 'users/user1/rewardLedger/xp',
      parent: { path: 'users/user1/rewardLedger' } },
    userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_REFERENCE_SCOPE_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});

test('conversion rejects aliased references before transaction reads', async () => {
  const { refs, tx, writes } = makeTx(1000);
  let reads = 0;
  const guardedTx = { ...tx, get: async (r: { id: string }) => { reads++; return tx.get(r); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(guardedTx as never, {
    ...refs, receiptRef: refs.balanceRef,
    userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_REFERENCE_SCOPE_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});

test('conversion rejects balance projection placed in XP ledger before reads', async () => {
  const { refs, tx, writes } = makeTx(1000);
  let reads = 0;
  const guardedTx = { ...tx, get: async (r: { id: string }) => { reads++; return tx.get(r); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(guardedTx as never, {
    ...refs,
    balanceRef: { id: 'balance', path: 'users/user1/xpLedger/balance',
      parent: { path: 'users/user1/xpLedger' } },
    userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_REFERENCE_SCOPE_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});

test('conversion rejects receipt placed in reward ledger before reads', async () => {
  const { refs, tx, writes } = makeTx(1000);
  let reads = 0;
  const guardedTx = { ...tx, get: async (r: { id: string }) => { reads++; return tx.get(r); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(guardedTx as never, {
    ...refs,
    receiptRef: { id: 'receipt', path: 'users/user1/rewardLedger/receipt',
      parent: { path: 'users/user1/rewardLedger' } },
    userId: 'user1', requestId: 'req1', requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_REFERENCE_SCOPE_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});


test('conversion rejects a shadow balance document before reads', async () => {
  const { refs, writes } = makeTx(1000);
  let reads = 0;
  const tx = { get: async () => { reads++; throw new Error('SHOULD_NOT_READ'); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, balanceRef: { id: 'shadow', path: 'users/user1/pitangaBalance/shadow',
      parent: { path: 'users/user1/pitangaBalance' } },
    userId: 'user1', requestId: 'req1', requestedXp: 1,
    occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_REFERENCE_SCOPE_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});

test('conversion replay returns current canonical balance after later earning', async () => {
  const { refs, tx, writes } = makeTx(750, true);
  const result = await applyPitangaXpConversionInTransaction(tx as never, {
    ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1,
    occurredAt: '2026-11-11T12:00:01Z',
  } as never);
  assert.deepEqual(result, {
    xpCredited: 1, pitangasDebited: 1000, remainingPitangas: 750, replay: true,
  });
  assert.equal(writes.length, 0);
});

test('conversion replay rejects malformed original balance without writes', async () => {
  for (const original of ['1000', 1000.5, -1]) {
    const { refs, tx, writes } = makeTx(750, true);
    const tampered = {
      ...tx,
      get: async (r: { id: string }) => r.path === refs.receiptRef.path
        ? { exists: true, data: () => ({
            userId: 'user1', requestId: 'req1', requestedXp: 1,
            availablePitangasBefore: original, status: 'committed',
            occurredAt: '2026-11-11T12:00:00Z',
          }) }
        : tx.get(r),
    };
    await assert.rejects(() => applyPitangaXpConversionInTransaction(tampered as never, {
      ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1,
      occurredAt: '2026-11-11T12:00:01Z',
    } as never), /CONVERSION_RECEIPT_INCONSISTENT/);
    assert.equal(writes.length, 0);
  }
});

test('conversion rejects a non-migrated balance on new and replay requests', async () => {
  for (const replay of [false, true]) {
    const { refs, tx, writes } = makeTx(1000, replay);
    const unverified = {
      ...tx,
      get: async (r: { id: string }) => r.id === 'balance'
        ? { exists: true, data: () => ({ userId: 'user1', availableKCoins: 1000 }) }
        : tx.get(r),
    };
    await assert.rejects(() => applyPitangaXpConversionInTransaction(unverified as never, {
      ...refs, userId: 'user1', requestId: 'req1', requestedXp: 1,
      occurredAt: '2026-11-11T12:00:00Z',
    } as never), replay ? /CONVERSION_REPLAY_BALANCE_UNAVAILABLE/ : /CONVERSION_BALANCE_NOT_INITIALIZED/);
    assert.equal(writes.length, 0);
  }
});

test('conversion rejects a receipt redirected to another user collection before reads', async () => {
  const { refs, tx, writes } = makeTx(1000);
  let reads = 0;
  const guardedTx = { ...tx, get: async (r: { id: string }) => { reads++; return tx.get(r); } };
  await assert.rejects(() => applyPitangaXpConversionInTransaction(guardedTx as never, {
    ...refs,
    receiptRef: { id: 'receipt', path: 'users/user1/rewardAudit/receipt',
      parent: { path: 'users/user1/rewardAudit' } },
    userId: 'user1', requestId: 'req1', requestedXp: 1,
    occurredAt: '2026-11-11T12:00:00Z',
  } as never), /CONVERSION_REFERENCE_SCOPE_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});

test('rejects arbitrary conversion document IDs before Firestore reads', async () => {
  const { refs, tx, writes } = makeTx(1000);
  for (const field of ['debitRef', 'xpRef', 'receiptRef'] as const) {
    const original = refs[field];
    const altered = { ...original, id: 'wrong_id',
      path: `${original.parent.path}/wrong_id` };
    let reads = 0;
    const guardedTx = { ...tx, get: async (r: { path: string }) => {
      reads++; return tx.get(r);
    } };
    await assert.rejects(() => applyPitangaXpConversionInTransaction(guardedTx as never, {
      ...refs, [field]: altered, userId: 'user1', requestId: 'req1',
      requestedXp: 1, occurredAt: '2026-11-11T12:00:00Z',
    } as never), /CONVERSION_REFERENCE_SCOPE_INVALID/);
    assert.equal(reads, 0, `${field} must be rejected before reads`);
    assert.equal(writes.length, 0);
  }
});
