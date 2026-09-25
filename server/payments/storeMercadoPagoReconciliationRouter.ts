import { createHash } from 'node:crypto';
import { Router } from 'express';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  getValidMercadoPagoStoreAccessToken,
  mercadoPagoStoreRequest,
} from '../integrations/mercadoPagoStoreOauthService.js';
import { loadMercadoPagoPaymentProviderBinding } from './paymentProviderBindingService.js';
import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  normalizeStoreProviderPaymentReconciliation,
  storeProviderPaymentReconciliationPath,
  type StoreProviderPaymentFeeEvidence,
  type StoreProviderPaymentReconciliation,
} from '../../shared/storeProviderPaymentReconciliation.js';

type MercadoPagoFeeDetail = {
  type?: unknown;
  fee_payer?: unknown;
  amount?: unknown;
};

type MercadoPagoPaymentDetails = {
  id?: unknown;
  status?: unknown;
  status_detail?: unknown;
  currency_id?: unknown;
  collector_id?: unknown;
  transaction_amount?: unknown;
  payment_method_id?: unknown;
  payment_type_id?: unknown;
  installments?: unknown;
  money_release_date?: unknown;
  money_release_status?: unknown;
  date_last_updated?: unknown;
  date_approved?: unknown;
  date_created?: unknown;
  fee_details?: MercadoPagoFeeDetail[];
  transaction_details?: {
    net_received_amount?: unknown;
    total_paid_amount?: unknown;
  };
};

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const isMercadoPagoProvider = (value: unknown): boolean =>
  clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '') === 'mercadopago';

const toMinor = (value: unknown): number | null => {
  if (value === null || value === undefined || clean(value) === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : null;
};

const optionalPositiveInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || clean(value) === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeProviderIso = (value: unknown): string => {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : '';
};

const canonicalPaymentMinor = (payment: CanonicalPayment): number =>
  Math.round(payment.amount * 100);

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

const loadCanonicalPayment = async (
  storeId: string,
  paymentId: string
): Promise<CanonicalPayment> => {
  const snapshot = await adminDb.doc(`stores/${storeId}/payments/${paymentId}`).get();
  if (!snapshot.exists) throw new Error('STORE_PROVIDER_RECONCILIATION_PAYMENT_NOT_FOUND');
  try {
    return normalizeCanonicalPayment({
      ...(snapshot.data() as CanonicalPayment),
      id: paymentId,
      storeId,
    });
  } catch {
    throw new Error('STORE_PROVIDER_RECONCILIATION_PAYMENT_INVALID');
  }
};

const legacyStoreIdForCanonicalStore = async (canonicalStoreId: string): Promise<string> => {
  const snapshot = await adminDb.doc(`stores/${canonicalStoreId}`).get();
  if (!snapshot.exists) throw new Error('STORE_PROVIDER_RECONCILIATION_STORE_NOT_FOUND');
  const data = snapshot.data() as Record<string, unknown>;
  const legacyStoreId = clean(data.legacyTenantId) || clean(data.ownerId);
  if (!legacyStoreId || clean(data.ownerId) !== legacyStoreId) {
    throw new Error('STORE_PROVIDER_RECONCILIATION_STORE_SCOPE_INVALID');
  }
  return legacyStoreId;
};

const feeEvidence = (payment: MercadoPagoPaymentDetails): StoreProviderPaymentFeeEvidence[] =>
  (Array.isArray(payment.fee_details) ? payment.fee_details : []).flatMap(detail => {
    const type = clean(detail?.type).toLowerCase();
    const payer = clean(detail?.fee_payer).toLowerCase();
    const amountMinor = toMinor(detail?.amount);
    return type && payer && amountMinor !== null
      ? [{ type, payer, amountMinor }]
      : [];
  });

const feeSummary = (fees: StoreProviderPaymentFeeEvidence[]) => {
  const collectorFees = fees.filter(fee => fee.payer === 'collector');
  if (collectorFees.length === 0) {
    return {
      providerFeeMinor: null,
      mercadoPagoFeeMinor: null,
      financingFeeMinor: null,
      otherCollectorFeeMinor: null,
    };
  }
  const sum = (items: StoreProviderPaymentFeeEvidence[]) =>
    items.reduce((total, fee) => total + fee.amountMinor, 0);
  const mercadoPago = collectorFees.filter(fee =>
    fee.type === 'mercadopago_fee' || fee.type === 'mercado_pago_fee'
  );
  const financing = collectorFees.filter(fee => fee.type === 'financing_fee');
  const other = collectorFees.filter(fee =>
    fee.type !== 'mercadopago_fee'
    && fee.type !== 'mercado_pago_fee'
    && fee.type !== 'financing_fee'
  );
  return {
    providerFeeMinor: sum(collectorFees),
    mercadoPagoFeeMinor: mercadoPago.length > 0 ? sum(mercadoPago) : null,
    financingFeeMinor: financing.length > 0 ? sum(financing) : null,
    otherCollectorFeeMinor: other.length > 0 ? sum(other) : null,
  };
};

const evidenceFingerprint = (
  input: Omit<StoreProviderPaymentReconciliation, 'evidenceFingerprint' | 'reconciledAt'>
): string => createHash('sha256').update(JSON.stringify(input)).digest('hex');

const buildReconciliation = (input: {
  storeId: string;
  payment: CanonicalPayment;
  providerPayment: MercadoPagoPaymentDetails;
}): StoreProviderPaymentReconciliation => {
  const providerPaymentId = clean(input.providerPayment.id);
  const status = clean(input.providerPayment.status).toLowerCase();
  const currency = clean(input.providerPayment.currency_id).toUpperCase();
  const grossMinor = toMinor(input.providerPayment.transaction_amount);
  const expectedMinor = canonicalPaymentMinor(input.payment);
  if (
    providerPaymentId !== input.payment.providerPaymentId
    || !status
    || currency !== 'BRL'
    || grossMinor === null
    || grossMinor !== expectedMinor
  ) {
    throw new Error('STORE_PROVIDER_RECONCILIATION_PROVIDER_FACT_MISMATCH');
  }

  const fees = feeEvidence(input.providerPayment);
  const summarizedFees = feeSummary(fees);
  const base = {
    schemaVersion: 1 as const,
    storeId: input.storeId,
    paymentId: input.payment.id,
    orderId: input.payment.orderId,
    provider: 'mercado-pago' as const,
    providerPaymentId,
    currency: 'BRL' as const,
    canonicalPaymentMethod: input.payment.method,
    providerPaymentMethodId: clean(input.providerPayment.payment_method_id).toLowerCase(),
    providerPaymentTypeId: clean(input.providerPayment.payment_type_id).toLowerCase(),
    installments: optionalPositiveInteger(input.providerPayment.installments),
    providerStatus: status,
    providerStatusDetail: clean(input.providerPayment.status_detail).toLowerCase(),
    grossMinor,
    totalPaidMinor: toMinor(input.providerPayment.transaction_details?.total_paid_amount),
    ...summarizedFees,
    netReceivedMinor: toMinor(input.providerPayment.transaction_details?.net_received_amount),
    feeEvidence: fees,
    moneyReleaseDate: normalizeProviderIso(input.providerPayment.money_release_date),
    moneyReleaseStatus: clean(input.providerPayment.money_release_status).toLowerCase(),
    providerUpdatedAt: normalizeProviderIso(input.providerPayment.date_last_updated),
    sourceAuthority: 'mercado_pago_payment_api' as const,
  };
  return normalizeStoreProviderPaymentReconciliation({
    ...base,
    reconciledAt: new Date().toISOString(),
    evidenceFingerprint: evidenceFingerprint(base),
  });
};

const saveReconciliation = async (
  reconciliation: StoreProviderPaymentReconciliation
): Promise<void> => {
  const reference = adminDb.doc(storeProviderPaymentReconciliationPath(
    reconciliation.storeId,
    reconciliation.provider,
    reconciliation.providerPaymentId
  ));
  const observation = reference.collection('observations').doc(reconciliation.evidenceFingerprint);
  await adminDb.runTransaction(async transaction => {
    const existingObservation = await transaction.get(observation);
    transaction.set(reference, reconciliation);
    if (!existingObservation.exists) {
      transaction.create(observation, reconciliation);
    }
  });
};

const reconcileMercadoPagoPayment = async (
  storeId: string,
  paymentId: string
): Promise<StoreProviderPaymentReconciliation> => {
  const payment = await loadCanonicalPayment(storeId, paymentId);
  if (!isMercadoPagoProvider(payment.provider) || !clean(payment.providerPaymentId)) {
    throw new Error('STORE_PROVIDER_RECONCILIATION_PROVIDER_UNSUPPORTED');
  }

  const binding = await loadMercadoPagoPaymentProviderBinding(payment.providerPaymentId);
  let legacyStoreId = '';
  if (binding) {
    if (
      binding.canonicalStoreId !== storeId
      || binding.paymentId !== payment.id
      || binding.providerPaymentId !== payment.providerPaymentId
    ) {
      throw new Error('STORE_PROVIDER_RECONCILIATION_BINDING_MISMATCH');
    }
    legacyStoreId = binding.legacyStoreId;
  } else {
    legacyStoreId = await legacyStoreIdForCanonicalStore(storeId);
  }

  const secret = await getValidMercadoPagoStoreAccessToken(legacyStoreId);
  const providerPayment = await mercadoPagoStoreRequest<MercadoPagoPaymentDetails>(
    legacyStoreId,
    `/v1/payments/${encodeURIComponent(payment.providerPaymentId)}`
  );
  const collectorId = clean(providerPayment.collector_id);
  if (
    (collectorId && collectorId !== secret.externalAccountId)
    || (!binding && !collectorId)
  ) {
    throw new Error('STORE_PROVIDER_RECONCILIATION_ACCOUNT_MISMATCH');
  }

  const reconciliation = buildReconciliation({ storeId, payment, providerPayment });
  await saveReconciliation(reconciliation);
  return reconciliation;
};

const loadReconciliation = async (
  storeId: string,
  paymentId: string
): Promise<StoreProviderPaymentReconciliation | null> => {
  const payment = await loadCanonicalPayment(storeId, paymentId);
  if (!isMercadoPagoProvider(payment.provider) || !clean(payment.providerPaymentId)) return null;
  const snapshot = await adminDb.doc(storeProviderPaymentReconciliationPath(
    storeId,
    'mercado-pago',
    payment.providerPaymentId
  )).get();
  if (!snapshot.exists) return null;
  try {
    const reconciliation = normalizeStoreProviderPaymentReconciliation(snapshot.data());
    return reconciliation.paymentId === payment.id ? reconciliation : null;
  } catch {
    throw new Error('STORE_PROVIDER_RECONCILIATION_SNAPSHOT_INVALID');
  }
};

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente.', code };
  }
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') {
    return { status: 403, message: 'Você não pode reconciliar pagamentos desta loja.', code };
  }
  if (
    code === 'STORE_PROVIDER_RECONCILIATION_PAYMENT_NOT_FOUND'
    || code === 'STORE_PROVIDER_RECONCILIATION_STORE_NOT_FOUND'
  ) {
    return { status: 404, message: 'Pagamento ou loja não encontrado.', code };
  }
  if (code === 'MERCADO_PAGO_STORE_NOT_CONNECTED') {
    return { status: 409, message: 'Conecte a conta Mercado Pago da loja antes de reconciliar.', code };
  }
  if (
    code === 'STORE_PROVIDER_RECONCILIATION_PROVIDER_UNSUPPORTED'
    || code === 'STORE_PROVIDER_RECONCILIATION_PAYMENT_INVALID'
  ) {
    return { status: 400, message: 'Este pagamento não pode ser reconciliado com o Mercado Pago.', code };
  }
  if (
    code === 'STORE_PROVIDER_RECONCILIATION_BINDING_MISMATCH'
    || code === 'STORE_PROVIDER_RECONCILIATION_ACCOUNT_MISMATCH'
    || code === 'STORE_PROVIDER_RECONCILIATION_PROVIDER_FACT_MISMATCH'
    || code === 'STORE_PROVIDER_RECONCILIATION_STORE_SCOPE_INVALID'
    || code === 'STORE_PROVIDER_RECONCILIATION_SNAPSHOT_INVALID'
  ) {
    return {
      status: 409,
      message: 'Os dados do provedor divergem do pagamento canônico. Revise a conciliação antes de prosseguir.',
      code,
    };
  }
  if (code.startsWith('MERCADO_PAGO_STORE_API_ERROR:')) {
    return { status: 502, message: 'O Mercado Pago não respondeu com dados conciliáveis agora.', code };
  }
  console.error('[Store Mercado Pago reconciliation]', error);
  return {
    status: 503,
    message: 'Não foi possível reconciliar este pagamento agora.',
    code: 'STORE_PROVIDER_RECONCILIATION_UNAVAILABLE',
  };
};

export const createStoreMercadoPagoReconciliationRouter = (): Router => {
  const router = Router();

  router.get('/provider-reconciliation', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      const paymentId = clean(request.query.paymentId);
      if (!storeId || !paymentId) throw new Error('STORE_PROVIDER_RECONCILIATION_PAYMENT_INVALID');
      await requireOwner(clean(request.headers.authorization), storeId);
      const reconciliation = await loadReconciliation(storeId, paymentId);
      response.status(200).json({ reconciliation });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/provider-reconciliation', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      const paymentId = clean(request.query.paymentId);
      if (!storeId || !paymentId) throw new Error('STORE_PROVIDER_RECONCILIATION_PAYMENT_INVALID');
      await requireOwner(clean(request.headers.authorization), storeId);
      const reconciliation = await reconcileMercadoPagoPayment(storeId, paymentId);
      response.status(200).json({ reconciliation });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
