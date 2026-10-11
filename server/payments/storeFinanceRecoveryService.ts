import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { normalizeCanonicalPayment, type CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import {
  buildPaymentCaptureEconomicEntryId,
  buildRecoveredPaymentCaptureEconomicEntry,
  storeEconomicLedgerEntryPath,
} from '../../shared/storeEconomicLedger.js';

/**
 * Single cross-function recovery authority for legacy PAID captures.
 *
 * - GET callers first verify owner identity, then run this same authority.
 * - Firestore coordination prevents concurrent full-store scans.
 * - create() is atomic create-if-absent, so duplicate workers and provider
 *   webhook races never overwrite an existing economic ledger entry.
 * - Small checkpoints avoid unbounded serverless work; incomplete/busy passes
 *   reject financial reports instead of presenting misleading partial totals.
 * - Completed scans are cached for one day. New normal paid payments are
 *   written to the ledger by the payment webhook, not through this backfill.
 */
export const FINANCE_RECOVERY_BATCH_SIZE = 100;
export const FINANCE_RECOVERY_MAX_BATCHES_PER_CALL = 5;
export const FINANCE_RECOVERY_LEASE_MS = 120_000;
export const FINANCE_RECOVERY_RECHECK_MS = 86_400_000;

export type PaidFinanceSnapshot = { id: string; data: Record<string, unknown> };
export type FinanceRecoveryLease =
  | { kind: 'complete' }
  | { kind: 'busy' }
  | { kind: 'acquired'; token: string; cursor: string };

export type FinanceRecoveryPort = {
  acquire(storeId: string): Promise<FinanceRecoveryLease>;
  list(storeId: string, afterId: string, pageSize: number): Promise<PaidFinanceSnapshot[]>;
  createCapture(storeId: string, payment: CanonicalPayment): Promise<boolean>;
  checkpoint(storeId: string, token: string, cursor: string, outcome: 'running' | 'pending' | 'complete'): Promise<void>;
};

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const validPaidFinanceCapture = (payment: CanonicalPayment): boolean =>
  payment.status === 'paid' &&
  Boolean(payment.paidAt) && Number.isFinite(Date.parse(payment.paidAt)) &&
  Boolean(payment.provider) && Boolean(payment.providerPaymentId);

export const isFinanceCaptureAlreadyExists = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 6 || code === '6' || code === 'already-exists' || code === 'ALREADY_EXISTS';
};

const coordinator = (storeId: string) =>
  adminDb.doc(`stores/${storeId}/financeRecoveryCoordination/current`);

const firestoreRecoveryPort: FinanceRecoveryPort = {
  acquire: async (storeId) => {
    const ref = coordinator(storeId);
    return adminDb.runTransaction(async transaction => {
      const current = (await transaction.get(ref)).data() as Record<string, unknown> | undefined;
      const now = Date.now();
      if (current) {
        if (current.schemaVersion !== 1 || current.storeId !== storeId ||
          !['running', 'pending', 'complete'].includes(String(current.status)) ||
          typeof current.cursor !== 'string') {
          throw new Error('STORE_FINANCE_RECOVERY_STATE_INVALID');
        }
        if (current.status === 'running' && typeof current.leaseUntilMs !== 'number')
          throw new Error('STORE_FINANCE_RECOVERY_STATE_INVALID');
        if (current.status === 'complete' &&
          typeof current.completedAtMs !== 'number')
          throw new Error('STORE_FINANCE_RECOVERY_STATE_INVALID');
        if (current.status === 'complete' &&
          now - (current.completedAtMs as number) < FINANCE_RECOVERY_RECHECK_MS)
          return { kind: 'complete' } as const;
        if (current.status === 'running' && (current.leaseUntilMs as number) > now)
          return { kind: 'busy' } as const;
      }
      const token = randomUUID();
      const cursor = current?.status === 'pending' || current?.status === 'running'
        ? clean(current.cursor)
        : '';
      transaction.set(ref, {
        schemaVersion: 1, storeId, token, cursor,
        status: 'running',
        leaseUntilMs: now + FINANCE_RECOVERY_LEASE_MS,
        completedAtMs: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { kind: 'acquired', token, cursor } as const;
    });
  },
  list: async (storeId, afterId, pageSize) => {
    let query = adminDb.collection(`stores/${storeId}/payments`)
      .where('status', '==', 'paid')
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (afterId) query = query.startAfter(afterId);
    const snapshot = await query.get();
    return snapshot.docs.map(document => ({
      id: document.id, data: document.data() as Record<string, unknown>,
    }));
  },
  createCapture: async (storeId, payment) => {
    const ref = adminDb.doc(
      storeEconomicLedgerEntryPath(storeId, buildPaymentCaptureEconomicEntryId(payment.id))
    );
    try {
      await ref.create(buildRecoveredPaymentCaptureEconomicEntry({
        payment, paymentIntentId: payment.paymentIntentId ?? '',
      }));
      return true;
    } catch (error) {
      if (isFinanceCaptureAlreadyExists(error)) return false;
      throw error;
    }
  },
  checkpoint: async (storeId, token, cursor, outcome) => {
    const ref = coordinator(storeId);
    await adminDb.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      const current = snap.data() as Record<string, unknown> | undefined;
      if (!current || current.schemaVersion !== 1 || current.storeId !== storeId ||
        current.status !== 'running' || current.token !== token) {
        throw new Error('STORE_FINANCE_RECOVERY_LEASE_LOST');
      }
      const now = Date.now();
      transaction.update(ref, {
        cursor, status: outcome,
        leaseUntilMs: outcome === 'running' ? now + FINANCE_RECOVERY_LEASE_MS : 0,
        completedAtMs: outcome === 'complete' ? now : 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  },
};

/**
 * Execute the same resumable, bounded recovery for either financial GET.
 * The adapter is explicit so concurrent-GET and crash/retry contracts can
 * be tested without accessing Firebase or touching real customer payments.
 */
export const executeSharedFinanceRecovery = async (
  storeId: string,
  port: FinanceRecoveryPort,
  retryBusy: () => Promise<void> = () =>
    new Promise<void>(resolve => setTimeout(resolve, 500))
): Promise<number> => {
  // Financeiro Interno mounts independent read-only widgets. On an initial
  // legacy recovery two GETs may arrive at once. Wait briefly for the first
  // lease holder instead of failing an otherwise valid management view.
  let lease = await port.acquire(storeId);
  for (let attempt = 0; lease.kind === 'busy' && attempt < 12; attempt++) {
    await retryBusy();
    lease = await port.acquire(storeId);
  }
  if (lease.kind === 'complete') return 0;
  if (lease.kind === 'busy') throw new Error('STORE_FINANCE_RECOVERY_IN_PROGRESS');
  let cursor = lease.cursor;
  let recoveredCount = 0;
  for (let page = 0; page < FINANCE_RECOVERY_MAX_BATCHES_PER_CALL; page++) {
    const snapshots = await port.list(storeId, cursor, FINANCE_RECOVERY_BATCH_SIZE);
    let lastId = cursor;
    const candidates: CanonicalPayment[] = [];
    for (const snapshot of snapshots) {
      if (!snapshot.id || (lastId && snapshot.id <= lastId))
        throw new Error('STORE_FINANCE_RECOVERY_ORDER_INVALID');
      lastId = snapshot.id;
      try {
        const payment = normalizeCanonicalPayment({
          ...(snapshot.data as unknown as CanonicalPayment), id: snapshot.id, storeId,
        });
        if (validPaidFinanceCapture(payment)) candidates.push(payment);
      } catch (error) {
        console.warn('[Store finance recovery] Skipping invalid historical paid snapshot.', {
          storeId, paymentId: snapshot.id,
          error: error instanceof Error ? error.message : 'invalid payment',
        });
      }
    }
    // Keep per-document create-if-absent atomic and bound concurrent calls.
    for (let i = 0; i < candidates.length; i += 10) {
      const result = await Promise.all(
        candidates.slice(i, i + 10).map(payment => port.createCapture(storeId, payment))
      );
      recoveredCount += result.filter(Boolean).length;
    }
    cursor = lastId;
    const completed = snapshots.length < FINANCE_RECOVERY_BATCH_SIZE;
    const budgetExhausted = page === FINANCE_RECOVERY_MAX_BATCHES_PER_CALL - 1;
    await port.checkpoint(
      storeId, lease.token, cursor,
      completed ? 'complete' : budgetExhausted ? 'pending' : 'running'
    );
    if (completed) return recoveredCount;
  }
  // Work is deliberately bounded. Release ownership as "pending" while
  // preserving the committed cursor, so next authorized read can resume
  // immediately rather than being blocked by an expired-lease timer.
  throw new Error('STORE_FINANCE_RECOVERY_CONTINUATION_REQUIRED');
};

export const recoverCanonicalPaidCaptures = (storeId: string): Promise<number> =>
  executeSharedFinanceRecovery(storeId, firestoreRecoveryPort);
