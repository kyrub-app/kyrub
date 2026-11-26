import { financeMonthRange, parseFinancePeriodTimeZone, type FinanceMonthRange, type FinancePeriodTimeZone } from '../../shared/storeFinanceCalendar.js';
import { createStoreCostCenterPeriodAccumulator } from '../../shared/storeFinanceCostCenterPeriod.js';
import { Router } from 'express';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {getOfficialOperationalPhaseForLegacyStore} from '../admin/officialOperationalPhaseService.js';
import {effectiveHistoryStart} from '../../shared/officialOperationalPhase.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
  type PaymentMethod,
} from '../../src/utils/canonicalPayment.js';
import {
  buildPaymentCaptureEconomicEntryId,
  buildRecoveredPaymentCaptureEconomicEntry,
  STORE_ECONOMIC_LEDGER_SCHEMA_VERSION,
  storeEconomicLedgerEntryPath,
  type StoreEconomicLedgerEntry,
  type StoreEconomicLedgerKind,
  type StoreEconomicLedgerSourceAuthority,
} from '../../shared/storeEconomicLedger.js';
import {
  ECONOMIC_OBLIGATION_SCHEMA_VERSION,
  type EconomicObligation,
  type EconomicObligationStatus,
} from '../../shared/economicObligations.js';
import {
  normalizeStoreFinancePayable,
  type StoreFinancePayable,
  type StoreFinancePayableCategory,
} from '../../shared/storeFinancePayables.js';

const HISTORY_DEFAULT_LIMIT = 25;
const HISTORY_MAX_LIMIT = 50;
const HISTORY_SCAN_BATCH = 100;
const HISTORY_MAX_SCANNED_PER_REQUEST = 1000;
const PERIOD_SCAN_BATCH = 250;
const RECOVERY_BATCH = 200;

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
    return { status: 403, message: 'Você não pode consultar o histórico financeiro desta loja.', code };
  }
  if (code === 'STORE_FINANCE_HISTORY_STORE_REQUIRED') {
    return { status: 400, message: 'Loja não identificada.', code };
  }
  if (code === 'STORE_FINANCE_HISTORY_PERIOD_INVALID') {
    return { status: 400, message: 'Competência financeira inválida.', code };
  }
  if (code === 'STORE_FINANCE_HISTORY_FILTER_INVALID' || code === 'STORE_FINANCE_HISTORY_CURSOR_INVALID') {
    return { status: 400, message: 'Revise os filtros do histórico financeiro.', code };
  }
  console.error('[Store finance history]', error);
  return {
    status: 503,
    message: 'Não foi possível carregar o histórico financeiro agora.',
    code: 'STORE_FINANCE_HISTORY_UNAVAILABLE',
  };
};

const requireOwner = async (authorization: string, storeId: string): Promise<string> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  await loadOwnerStoreInstitutionalRepresentation({
    storeId,
    authenticatedUserId: identity.uid,
  });
  return identity.uid;
};

type PeriodRange = FinanceMonthRange;

const parsePeriod = (value: unknown, required = false, zone:FinancePeriodTimeZone='UTC'): PeriodRange | null => {
  const period = clean(value);
  if (!period) {
    if (required) throw new Error('STORE_FINANCE_HISTORY_PERIOD_INVALID');
    return null;
  }
  return financeMonthRange(period,zone);
};

const isLedgerKind = (value: unknown): value is StoreEconomicLedgerKind =>
  value === 'payment_capture'
  || value === 'payment_refund'
  || value === 'payment_chargeback'
  || value === 'payment_chargeback_reversal';

const parseLedgerKindFilter = (value: unknown): StoreEconomicLedgerKind | '' => {
  const normalized = clean(value);
  if (!normalized || normalized === 'all') return '';
  if (!isLedgerKind(normalized)) throw new Error('STORE_FINANCE_HISTORY_FILTER_INVALID');
  return normalized;
};

const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  value === 'pix' || value === 'card' || value === 'cash' || value === 'other';

const parsePaymentMethodFilter = (value: unknown): PaymentMethod | '' => {
  const normalized = clean(value);
  if (!normalized || normalized === 'all') return '';
  if (!isPaymentMethod(normalized)) throw new Error('STORE_FINANCE_HISTORY_FILTER_INVALID');
  return normalized;
};

const isSourceAuthority = (value: unknown): value is StoreEconomicLedgerSourceAuthority =>
  value === 'provider_webhook'
  || value === 'canonical_payment_snapshot'
  || value === 'operator_attestation';

const parseLedgerEntry = (
  storeId: string,
  documentId: string,
  value: unknown
): StoreEconomicLedgerEntry | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Partial<StoreEconomicLedgerEntry>;
  let expectedId = '';
  try {
    expectedId = decodeURIComponent(documentId);
  } catch {
    return null;
  }
  if (
    entry.schemaVersion !== STORE_ECONOMIC_LEDGER_SCHEMA_VERSION
    || entry.id !== expectedId
    || entry.storeId !== storeId
    || entry.currency !== 'BRL'
    || !isLedgerKind(entry.kind)
    || !Number.isSafeInteger(entry.amountMinor)
    || Number(entry.amountMinor) === 0
    || !clean(entry.paymentId)
    || !clean(entry.orderId)
    || !clean(entry.buyerId)
    || !isPaymentMethod(entry.paymentMethod)
    || !clean(entry.provider)
    || !clean(entry.providerPaymentId)
    || !isSourceAuthority(entry.sourceAuthority)
    || !clean(entry.occurredAt)
    || !Number.isFinite(Date.parse(clean(entry.occurredAt)))
  ) {
    return null;
  }
  if (
    (entry.kind === 'payment_capture' || entry.kind === 'payment_chargeback_reversal')
    && Number(entry.amountMinor) <= 0
  ) return null;
  if (
    (entry.kind === 'payment_refund' || entry.kind === 'payment_chargeback')
    && Number(entry.amountMinor) >= 0
  ) return null;
  return entry as StoreEconomicLedgerEntry;
};

const providerFeeMinor = (entry: StoreEconomicLedgerEntry): number | null => {
  const costs = entry.economicAllocation?.observedCosts ?? [];
  const fees = costs.filter(cost =>
    cost.kind === 'provider_processing'
    && cost.borneBy === 'store'
    && Number.isSafeInteger(cost.amountMinor)
    && cost.amountMinor >= 0
  );
  if (fees.length === 0) return null;
  return fees.reduce((total, fee) => total + fee.amountMinor, 0);
};

type HistoryCursor = {
  occurredAt: string;
  documentId: string;
};

const encodeCursor = (cursor: HistoryCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const decodeCursor = (value: unknown): HistoryCursor | null => {
  const encoded = clean(value);
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<HistoryCursor>;
    const occurredAt = clean(parsed.occurredAt);
    const documentId = clean(parsed.documentId);
    if (!occurredAt || !Number.isFinite(Date.parse(occurredAt)) || !documentId) {
      throw new Error('STORE_FINANCE_HISTORY_CURSOR_INVALID');
    }
    return { occurredAt, documentId };
  } catch {
    throw new Error('STORE_FINANCE_HISTORY_CURSOR_INVALID');
  }
};

const historyLimit = (value: unknown): number => {
  const parsed = Number(clean(value));
  if (!Number.isFinite(parsed)) return HISTORY_DEFAULT_LIMIT;
  return Math.max(1, Math.min(HISTORY_MAX_LIMIT, Math.trunc(parsed)));
};

const canRecoverPaidCapture = (payment: CanonicalPayment): boolean =>
  payment.status === 'paid'
  && Boolean(payment.paidAt)
  && Number.isFinite(Date.parse(payment.paidAt))
  && Boolean(payment.provider)
  && Boolean(payment.providerPaymentId);

const recoverAllMissingCanonicalPaidCaptures = async (storeId: string): Promise<number> => {
  let lastDocumentId = '';
  let recoveredCount = 0;
  while (true) {
    let query = adminDb.collection(`stores/${storeId}/payments`).where('status', '==', 'paid').orderBy(FieldPath.documentId()).limit(RECOVERY_BATCH);
    if (lastDocumentId) query = query.startAfter(lastDocumentId);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    const candidates = snapshot.docs.flatMap(document => {
      try {
        const payment = normalizeCanonicalPayment({ ...(document.data() as CanonicalPayment), id: document.id, storeId });
        return canRecoverPaidCapture(payment) ? [payment] : [];
      } catch (error) {
        console.warn('[Store finance history] Invalid historical payment skipped.', { storeId, paymentId: document.id, error: error instanceof Error ? error.message : 'unknown' });
        return [];
      }
    });
    if (candidates.length > 0) {
      const refs = candidates.map(payment => adminDb.doc(storeEconomicLedgerEntryPath(storeId, buildPaymentCaptureEconomicEntryId(payment.id))));
      const writes = await adminDb.runTransaction(async transaction => {
        const existing = await transaction.getAll(...refs);
        let count = 0;
        candidates.forEach((payment, index) => {
          if (existing[index]?.exists) return;
          transaction.create(refs[index], buildRecoveredPaymentCaptureEconomicEntry({ payment, paymentIntentId: payment.paymentIntentId ?? '' }));
          count += 1;
        });
        return count;
      });
      recoveredCount += writes;
    }
    lastDocumentId = snapshot.docs[snapshot.docs.length - 1]?.id ?? '';
    if (snapshot.size < RECOVERY_BATCH || !lastDocumentId) break;
  }
  return recoveredCount;
};

// Share only work currently in flight, never a completed recovery result.
const activeCaptureRecoveries = new Map<string, Promise<number>>();
const recoverCanonicalPaidCaptures = (storeId: string): Promise<number> => {
  const existing = activeCaptureRecoveries.get(storeId);
  if (existing) return existing;
  const pending = recoverAllMissingCanonicalPaidCaptures(storeId).finally(() => {
    if (activeCaptureRecoveries.get(storeId) === pending) activeCaptureRecoveries.delete(storeId);
  });
  activeCaptureRecoveries.set(storeId, pending);
  return pending;
};

type HistoryItem = { id: string; kind: StoreEconomicLedgerKind; currency: 'BRL'; amountMinor: number; paymentId: string; orderId: string; buyerId: string; paymentMethod: PaymentMethod; provider: string; providerPaymentId: string; sourceAuthority: StoreEconomicLedgerSourceAuthority; occurredAt: string; providerFeeMinor: number | null };
const toHistoryItem = (entry: StoreEconomicLedgerEntry): HistoryItem => ({ id: entry.id, kind: entry.kind, currency: 'BRL', amountMinor: entry.amountMinor, paymentId: entry.paymentId, orderId: entry.orderId, buyerId: entry.buyerId, paymentMethod: entry.paymentMethod, provider: entry.provider, providerPaymentId: entry.providerPaymentId, sourceAuthority: entry.sourceAuthority, occurredAt: entry.occurredAt, providerFeeMinor: providerFeeMinor(entry) });

const listHistoryPage = async (input: { storeId: string; period: PeriodRange | null; kind: StoreEconomicLedgerKind | ''; paymentMethod: PaymentMethod | ''; cursor: HistoryCursor | null; limit: number; minOccurredAt: string }) => {
  const matches: Array<{ item: HistoryItem; cursor: HistoryCursor }> = [];
  let scanCursor = input.cursor;
  let lastScannedCursor = input.cursor;
  let exhausted = false;
  let scannedCount = 0;
  while (matches.length < input.limit + 1 && scannedCount < HISTORY_MAX_SCANNED_PER_REQUEST && !exhausted) {
    let query = adminDb.collection(`stores/${input.storeId}/economicLedger`).orderBy('occurredAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    const startIso=effectiveHistoryStart(input.period?.startIso??'',input.minOccurredAt);
    if(startIso)query=query.where('occurredAt','>=',startIso);
    if(input.period)query=query.where('occurredAt','<',input.period.endExclusiveIso);
    if (scanCursor) query = query.startAfter(scanCursor.occurredAt, scanCursor.documentId);
    const remainingScan = HISTORY_MAX_SCANNED_PER_REQUEST - scannedCount;
    const snapshot = await query.limit(Math.min(HISTORY_SCAN_BATCH, remainingScan)).get();
    if (snapshot.empty) { exhausted = true; break; }
    for (const document of snapshot.docs) {
      scannedCount += 1;
      const rawOccurredAt = clean(document.get('occurredAt'));
      if (rawOccurredAt) lastScannedCursor = { occurredAt: rawOccurredAt, documentId: document.id };
      const entry = parseLedgerEntry(input.storeId, document.id, document.data());
      if (!entry) continue;
      if (input.kind && entry.kind !== input.kind) continue;
      if (input.paymentMethod && entry.paymentMethod !== input.paymentMethod) continue;
      matches.push({ item: toHistoryItem(entry), cursor: { occurredAt: entry.occurredAt, documentId: document.id } });
      if (matches.length >= input.limit + 1) break;
    }
    if (matches.length >= input.limit + 1) break;
    if (snapshot.size < Math.min(HISTORY_SCAN_BATCH, remainingScan)) { exhausted = true; break; }
    scanCursor = lastScannedCursor;
  }
  const items = matches.slice(0, input.limit).map(match => match.item);
  const hasExtraMatch = matches.length > input.limit;
  const hasMore = hasExtraMatch || !exhausted;
  let nextCursor = '';
  if (hasMore) {
    if (hasExtraMatch && matches[input.limit - 1]) nextCursor = encodeCursor(matches[input.limit - 1].cursor);
    else if (lastScannedCursor) nextCursor = encodeCursor(lastScannedCursor);
  }
  return { items, nextCursor, hasMore: Boolean(nextCursor), scannedCount };
};

const aggregateLedgerPeriod = async (storeId: string, period: PeriodRange) => {
  let lastCursor: HistoryCursor | null = null;
  let capturedMinor = 0, refundedMinor = 0, chargedBackMinor = 0, chargebackReversedMinor = 0, providerFeesMinor = 0, entryCount = 0;
  while (true) {
    let query = adminDb.collection(`stores/${storeId}/economicLedger`).where('occurredAt', '>=', period.startIso).where('occurredAt', '<', period.endExclusiveIso).orderBy('occurredAt', 'asc').orderBy(FieldPath.documentId(), 'asc').limit(PERIOD_SCAN_BATCH);
    if (lastCursor) query = query.startAfter(lastCursor.occurredAt, lastCursor.documentId);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    for (const document of snapshot.docs) {
      const entry = parseLedgerEntry(storeId, document.id, document.data());
      const rawOccurredAt = clean(document.get('occurredAt'));
      if (rawOccurredAt) lastCursor = { occurredAt: rawOccurredAt, documentId: document.id };
      if (!entry) continue;
      entryCount += 1;
      if (entry.kind === 'payment_capture') capturedMinor += entry.amountMinor;
      else if (entry.kind === 'payment_refund') refundedMinor += Math.abs(entry.amountMinor);
      else if (entry.kind === 'payment_chargeback') chargedBackMinor += Math.abs(entry.amountMinor);
      else chargebackReversedMinor += entry.amountMinor;
      providerFeesMinor += providerFeeMinor(entry) ?? 0;
    }
    if (snapshot.size < PERIOD_SCAN_BATCH || !lastCursor) break;
  }
  const salesAfterReversalsMinor = capturedMinor - refundedMinor - chargedBackMinor + chargebackReversedMinor;
  return { capturedMinor, refundedMinor, chargedBackMinor, chargebackReversedMinor, providerFeesMinor, salesAfterReversalsMinor, providerObservedNetMinor: salesAfterReversalsMinor - providerFeesMinor, entryCount };
};

const aggregatePayablesPeriod = async (storeId: string, period: PeriodRange) => {
  let lastDocumentId = '', paidPayablesMinor = 0, openDueMinor = 0, paidPayableCount = 0, openDueCount = 0;
  const categoryTotals = new Map<string,{category:StoreFinancePayableCategory;customCategory?:{id:string;name:string};amountMinor:number}>();
  const costCenters = createStoreCostCenterPeriodAccumulator(period.timeZone);
  while (true) {
    let query = adminDb.collection(`stores/${storeId}/financePayables`).orderBy(FieldPath.documentId()).limit(PERIOD_SCAN_BATCH);
    if (lastDocumentId) query = query.startAfter(lastDocumentId);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    for (const document of snapshot.docs) {
      try {
        const payable = normalizeStoreFinancePayable({ ...(document.data() as StoreFinancePayable), id: document.id, storeId });
        if (payable.status === 'paid' && payable.paidAt >= period.startIso && payable.paidAt < period.endExclusiveIso) {
          paidPayablesMinor += payable.amountMinor; paidPayableCount += 1;
          const categoryKey=payable.customCategory?JSON.stringify([payable.customCategory.id,payable.customCategory.name]):payable.category;
          categoryTotals.set(categoryKey,{category:payable.category,...(payable.customCategory?{customCategory:payable.customCategory}:{}),amountMinor:(categoryTotals.get(categoryKey)?.amountMinor??0)+payable.amountMinor});
          costCenters.add(payable.costCenter, payable.amountMinor, 'paid');
        }
        if (payable.status === 'open' && payable.dueDate.startsWith(period.period)) { openDueMinor += payable.amountMinor; openDueCount += 1; costCenters.add(payable.costCenter, payable.amountMinor, 'open_due'); }
      } catch { costCenters.invalidPayable(); /* invalid canonical rows are excluded from accounting */ }
    }
    lastDocumentId = snapshot.docs[snapshot.docs.length - 1]?.id ?? '';
    if (snapshot.size < PERIOD_SCAN_BATCH || !lastDocumentId) break;
  }
  return { paidPayablesMinor, openDueMinor, paidPayableCount, openDueCount,
    costCenterReport:costCenters.finish({paidMinor:paidPayablesMinor,paidCount:paidPayableCount,openDueMinor,openDueCount}),
    categories: Array.from(categoryTotals.values()).sort((a, b) => b.amountMinor - a.amountMinor) };
};

const isEconomicObligationStatus = (value: unknown): value is EconomicObligationStatus => value === 'pending' || value === 'eligible' || value === 'settled' || value === 'reversed';
const validReceivable = (storeId: string, documentId: string, value: unknown): EconomicObligation | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obligation = value as Partial<EconomicObligation>;
  if (obligation.schemaVersion !== ECONOMIC_OBLIGATION_SCHEMA_VERSION || obligation.id !== documentId || obligation.storeId !== storeId || obligation.kind !== 'store_receivable' || !isEconomicObligationStatus(obligation.status) || obligation.currency !== 'BRL' || !Number.isSafeInteger(obligation.amountMinor) || Number(obligation.amountMinor) <= 0 || !clean(obligation.createdAt) || !Number.isFinite(Date.parse(clean(obligation.createdAt)))) return null;
  return obligation as EconomicObligation;
};

const aggregateReceivablesPeriod = async (storeId: string, period: PeriodRange) => {
  let lastDocumentId = '', createdMinor = 0, settledMinor = 0;
  while (true) {
    let query = adminDb.collection(`stores/${storeId}/economicObligations`).where('kind', '==', 'store_receivable').orderBy(FieldPath.documentId()).limit(PERIOD_SCAN_BATCH);
    if (lastDocumentId) query = query.startAfter(lastDocumentId);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    for (const document of snapshot.docs) {
      const receivable = validReceivable(storeId, document.id, document.data());
      if (!receivable) continue;
      const createdAt = clean(receivable.createdAt), settledAt = clean(receivable.settledAt);
      if (receivable.status !== 'reversed' && createdAt >= period.startIso && createdAt < period.endExclusiveIso) createdMinor += receivable.amountMinor;
      if (receivable.status === 'settled' && settledAt && settledAt >= period.startIso && settledAt < period.endExclusiveIso) settledMinor += receivable.amountMinor;
    }
    lastDocumentId = snapshot.docs[snapshot.docs.length - 1]?.id ?? '';
    if (snapshot.size < PERIOD_SCAN_BATCH || !lastDocumentId) break;
  }
  return { createdMinor, settledMinor };
};

const buildPeriodView = async (storeId: string, period: PeriodRange) => {
  const [ledger, payables, receivables] = await Promise.all([aggregateLedgerPeriod(storeId, period), aggregatePayablesPeriod(storeId, period), aggregateReceivablesPeriod(storeId, period)]);
  return { period: period.period, timeZone:period.timeZone, startIso:period.startIso,endExclusiveIso:period.endExclusiveIso, currency: 'BRL' as const, ...ledger, ...payables, receivablesCreatedMinor: receivables.createdMinor, receivablesSettledMinor: receivables.settledMinor, observedResultMinor: ledger.providerObservedNetMinor - payables.paidPayablesMinor, complete: true };
};

export const createStoreFinanceHistoryRouter = (): Router => {
  const router = Router();
  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_FINANCE_HISTORY_STORE_REQUIRED');
      await requireOwner(request.get('authorization') ?? '', storeId);
      const mode = clean(request.query.mode) || 'history';
      if (mode !== 'history' && mode !== 'period') throw new Error('STORE_FINANCE_HISTORY_FILTER_INVALID');
      // Validate the explicit calendar before the existing recovery side effect.
      const zone=parseFinancePeriodTimeZone(request.query.timeZone);
      if(mode!=='period'&&zone!=='UTC')throw Error('STORE_FINANCE_HISTORY_PERIOD_INVALID');
      const periodRange=mode==='period'?parsePeriod(request.query.period,true,zone):parsePeriod(request.query.period);
      if (mode === 'period') {
        const period = periodRange;
        if (!period) throw new Error('STORE_FINANCE_HISTORY_PERIOD_INVALID');
        const recoveredCount = await recoverCanonicalPaidCaptures(storeId);
        response.status(200).json({ storeId, recoveredCount, report: await buildPeriodView(storeId, period) });
        return;
      }
      const period = periodRange;
      const kind = parseLedgerKindFilter(request.query.kind);
      const paymentMethod = parsePaymentMethodFilter(request.query.paymentMethod);
      const cursor = decodeCursor(request.query.cursor);
      const limit = historyLimit(request.query.limit);
      const rawView=clean(request.query.view)||'current';
      if(rawView!=='current'&&rawView!=='all')throw Error('STORE_FINANCE_HISTORY_FILTER_INVALID');
      const phase=await getOfficialOperationalPhaseForLegacyStore(storeId);
      const recoveredCount = await recoverCanonicalPaidCaptures(storeId);
      const activeView=phase.active?rawView:'all';
      const page = await listHistoryPage({
        storeId,period,kind,paymentMethod,cursor,limit,
        minOccurredAt:activeView==='current'?phase.effectiveAt:''
      });
      response.status(200).json({
        storeId,recoveredCount,phase,view:activeView,
        // Financial periods and obligations remain complete: this is
        // exclusively a non-destructive history-list presentation filter.
        filters:{period:period?.period??'',kind:kind||'all',paymentMethod:paymentMethod||'all'},
        ...page
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });
  return router;
};
