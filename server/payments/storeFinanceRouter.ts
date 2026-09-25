import { Router } from 'express';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  buildPaymentCaptureEconomicEntryId,
  buildRecoveredPaymentCaptureEconomicEntry,
  deriveStoreEconomicLedgerSummary,
  storeEconomicLedgerEntryPath,
} from '../../shared/storeEconomicLedger.js';
import { listStoreEconomicLedgerEntries } from './storeEconomicLedgerService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente.', code };
  }
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') {
    return { status: 403, message: 'Você não pode consultar o financeiro desta loja.', code };
  }
  if (code === 'STORE_FINANCE_STORE_REQUIRED') {
    return { status: 400, message: 'Loja não identificada.', code };
  }
  console.error('[Store finance]', error);
  return {
    status: 503,
    message: 'Não foi possível carregar o financeiro da loja agora.',
    code: 'STORE_FINANCE_UNAVAILABLE',
  };
};

const requireOwner = async (authorization: string, storeId: string): Promise<void> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  await loadOwnerStoreInstitutionalRepresentation({
    storeId,
    authenticatedUserId: identity.uid,
  });
};

const canRecoverPaidCapture = (payment: CanonicalPayment): boolean =>
  payment.status === 'paid'
  && Boolean(payment.paidAt)
  && Number.isFinite(Date.parse(payment.paidAt))
  && Boolean(payment.provider)
  && Boolean(payment.providerPaymentId);

/**
 * Historical compatibility only. Payments confirmed before the economic ledger
 * was wired can be recovered from their canonical paid snapshot. The entry id is
 * deterministic, so reopening Financeiro cannot duplicate revenue.
 */
const recoverMissingCanonicalPaidCaptures = async (storeId: string): Promise<number> => {
  const paymentSnapshot = await adminDb
    .collection(`stores/${storeId}/payments`)
    .where('status', '==', 'paid')
    .limit(100)
    .get();

  const candidates = paymentSnapshot.docs.flatMap(document => {
    try {
      const payment = normalizeCanonicalPayment({
        ...(document.data() as CanonicalPayment),
        id: document.id,
        storeId,
      });
      return canRecoverPaidCapture(payment) ? [payment] : [];
    } catch (error) {
      console.warn('[Store finance] Invalid historical payment skipped.', {
        storeId,
        paymentId: document.id,
        error: error instanceof Error ? error.message : 'unknown',
      });
      return [];
    }
  });

  if (candidates.length === 0) return 0;

  const refs = candidates.map(payment =>
    adminDb.doc(
      storeEconomicLedgerEntryPath(
        storeId,
        buildPaymentCaptureEconomicEntryId(payment.id)
      )
    )
  );
  const existing = await adminDb.getAll(...refs);
  const batch = adminDb.batch();
  let recoveredCount = 0;

  candidates.forEach((payment, index) => {
    if (existing[index]?.exists) return;
    const entry = buildRecoveredPaymentCaptureEconomicEntry({
      payment,
      paymentIntentId: payment.paymentIntentId ?? '',
    });
    batch.set(refs[index], entry);
    recoveredCount += 1;
  });

  if (recoveredCount > 0) await batch.commit();
  return recoveredCount;
};

export const createStoreFinanceRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_FINANCE_STORE_REQUIRED');
      await requireOwner(request.get('authorization') ?? '', storeId);

      const recoveredCount = await recoverMissingCanonicalPaidCaptures(storeId);
      const entries = await listStoreEconomicLedgerEntries({ storeId, limit: 100 });
      const summary = deriveStoreEconomicLedgerSummary(entries);

      response.status(200).json({
        storeId,
        summary,
        entries,
        recoveredCount,
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
