import { Router } from 'express';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
  type StoreEconomicLedgerEntry,
} from '../../shared/storeEconomicLedger.js';
import {
  normalizeStoreProviderPaymentReconciliation,
  storeProviderPaymentReconciliationPath,
} from '../../shared/storeProviderPaymentReconciliation.js';

const SCAN_BATCH = 250;
const RECONCILIATION_GET_BATCH = 200;

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const isMercadoPago = (value: unknown): boolean =>
  clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '') === 'mercadopago';

const parsePeriod = (value: unknown): { period: string; startIso: string; endExclusiveIso: string } => {
  const period = clean(value);
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new Error('STORE_PROVIDER_PERIOD_INVALID');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error('STORE_PROVIDER_PERIOD_INVALID');
  }
  return {
    period,
    startIso: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    endExclusiveIso: new Date(Date.UTC(year, month, 1)).toISOString(),
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

const providerFeeMinor = (entry: StoreEconomicLedgerEntry): number | null => {
  const fees = (entry.economicAllocation?.observedCosts ?? []).filter(cost =>
    cost.kind === 'provider_processing'
    && cost.borneBy === 'store'
    && Number.isSafeInteger(cost.amountMinor)
    && cost.amountMinor >= 0
  );
  return fees.length === 0
    ? null
    : fees.reduce((total, fee) => total + fee.amountMinor, 0);
};

type MercadoPagoCapture = {
  paymentId: string;
  orderId: string;
  providerPaymentId: string;
  ledgerProviderFeeMinor: number | null;
};

const parseMercadoPagoCapture = (
  storeId: string,
  value: unknown
): MercadoPagoCapture | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Partial<StoreEconomicLedgerEntry>;
  if (
    entry.schemaVersion !== STORE_ECONOMIC_LEDGER_SCHEMA_VERSION
    || entry.storeId !== storeId
    || entry.currency !== 'BRL'
    || entry.kind !== 'payment_capture'
    || !clean(entry.paymentId)
    || !clean(entry.orderId)
    || !clean(entry.providerPaymentId)
    || !isMercadoPago(entry.provider)
  ) return null;
  return {
    paymentId: clean(entry.paymentId),
    orderId: clean(entry.orderId),
    providerPaymentId: clean(entry.providerPaymentId),
    ledgerProviderFeeMinor: providerFeeMinor(entry as StoreEconomicLedgerEntry),
  };
};

const listMercadoPagoCaptures = async (
  storeId: string,
  period: { startIso: string; endExclusiveIso: string }
): Promise<MercadoPagoCapture[]> => {
  const byPaymentId = new Map<string, MercadoPagoCapture>();
  let lastOccurredAt = '';
  let lastDocumentId = '';

  while (true) {
    let query = adminDb
      .collection(`stores/${storeId}/economicLedger`)
      .where('occurredAt', '>=', period.startIso)
      .where('occurredAt', '<', period.endExclusiveIso)
      .orderBy('occurredAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(SCAN_BATCH);
    if (lastOccurredAt && lastDocumentId) {
      query = query.startAfter(lastOccurredAt, lastDocumentId);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const document of snapshot.docs) {
      const occurredAt = clean(document.get('occurredAt'));
      if (occurredAt) {
        lastOccurredAt = occurredAt;
        lastDocumentId = document.id;
      }
      const capture = parseMercadoPagoCapture(storeId, document.data());
      if (capture) byPaymentId.set(capture.paymentId, capture);
    }

    if (snapshot.size < SCAN_BATCH || !lastOccurredAt || !lastDocumentId) break;
  }

  return Array.from(byPaymentId.values());
};

const summarizePeriod = async (
  storeId: string,
  period: { period: string; startIso: string; endExclusiveIso: string }
) => {
  const captures = await listMercadoPagoCaptures(storeId, period);
  let reconciledPaymentCount = 0;
  let ledgerFeeEvidenceCount = 0;
  let reconciliationFallbackFeeCount = 0;
  let ledgerProviderFeesMinor = 0;
  let reconciliationFallbackFeesMinor = 0;
  let explicitNetReceivedMinor = 0;
  let explicitNetReceivedCount = 0;
  let releaseDateEvidenceCount = 0;

  for (let offset = 0; offset < captures.length; offset += RECONCILIATION_GET_BATCH) {
    const slice = captures.slice(offset, offset + RECONCILIATION_GET_BATCH);
    const refs = slice.map(capture => adminDb.doc(storeProviderPaymentReconciliationPath(
      storeId,
      'mercado-pago',
      capture.providerPaymentId
    )));
    const snapshots = refs.length > 0 ? await adminDb.getAll(...refs) : [];

    slice.forEach((capture, index) => {
      if (capture.ledgerProviderFeeMinor !== null) {
        ledgerFeeEvidenceCount += 1;
        ledgerProviderFeesMinor += capture.ledgerProviderFeeMinor;
      }

      const snapshot = snapshots[index];
      if (!snapshot?.exists) return;
      try {
        const reconciliation = normalizeStoreProviderPaymentReconciliation(snapshot.data());
        if (
          reconciliation.storeId !== storeId
          || reconciliation.paymentId !== capture.paymentId
          || reconciliation.orderId !== capture.orderId
          || reconciliation.providerPaymentId !== capture.providerPaymentId
        ) return;

        reconciledPaymentCount += 1;
        if (
          capture.ledgerProviderFeeMinor === null
          && reconciliation.providerFeeMinor !== null
        ) {
          reconciliationFallbackFeeCount += 1;
          reconciliationFallbackFeesMinor += reconciliation.providerFeeMinor;
        }
        if (reconciliation.netReceivedMinor !== null) {
          explicitNetReceivedCount += 1;
          explicitNetReceivedMinor += reconciliation.netReceivedMinor;
        }
        if (reconciliation.moneyReleaseDate) releaseDateEvidenceCount += 1;
      } catch (error) {
        console.warn('[Store Mercado Pago period] Invalid reconciliation skipped.', {
          storeId,
          paymentId: capture.paymentId,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    });
  }

  const feeCoverageCount = new Set([
    ...captures.filter(capture => capture.ledgerProviderFeeMinor !== null).map(capture => capture.paymentId),
  ]);
  if (reconciliationFallbackFeeCount > 0) {
    for (let offset = 0; offset < captures.length; offset += RECONCILIATION_GET_BATCH) {
      const slice = captures.slice(offset, offset + RECONCILIATION_GET_BATCH);
      const refs = slice.map(capture => adminDb.doc(storeProviderPaymentReconciliationPath(
        storeId,
        'mercado-pago',
        capture.providerPaymentId
      )));
      const snapshots = refs.length > 0 ? await adminDb.getAll(...refs) : [];
      slice.forEach((capture, index) => {
        if (capture.ledgerProviderFeeMinor !== null || !snapshots[index]?.exists) return;
        try {
          const reconciliation = normalizeStoreProviderPaymentReconciliation(snapshots[index].data());
          if (reconciliation.paymentId === capture.paymentId && reconciliation.providerFeeMinor !== null) {
            feeCoverageCount.add(capture.paymentId);
          }
        } catch {
          // Invalid observations are already excluded from the monetary summary above.
        }
      });
    }
  }

  return {
    period: period.period,
    provider: 'mercado-pago' as const,
    captureCount: captures.length,
    reconciledPaymentCount,
    feeEvidenceCount: feeCoverageCount.size,
    ledgerFeeEvidenceCount,
    reconciliationFallbackFeeCount,
    providerFeesMinor: ledgerProviderFeesMinor + reconciliationFallbackFeesMinor,
    explicitNetReceivedMinor,
    explicitNetReceivedCount,
    releaseDateEvidenceCount,
    complete: true,
  };
};

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente.', code };
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') return { status: 403, message: 'Você não pode consultar esta conciliação.', code };
  if (code === 'STORE_PROVIDER_PERIOD_INVALID') return { status: 400, message: 'Competência inválida.', code };
  console.error('[Store Mercado Pago period]', error);
  return { status: 503, message: 'Não foi possível consolidar o Mercado Pago neste período.', code: 'STORE_PROVIDER_PERIOD_UNAVAILABLE' };
};

export const createStoreMercadoPagoPeriodSummaryRouter = (): Router => {
  const router = Router();
  router.get('/provider-period-summary', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_PROVIDER_PERIOD_INVALID');
      const period = parsePeriod(request.query.period);
      await requireOwner(clean(request.headers.authorization), storeId);
      const summary = await summarizePeriod(storeId, period);
      response.status(200).json({ storeId, summary });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });
  return router;
};
