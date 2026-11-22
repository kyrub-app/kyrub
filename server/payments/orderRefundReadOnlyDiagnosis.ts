import { adminDb } from '../firebaseAdmin.js';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

const positiveMinor = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
};

export interface OrderRefundReadOnlyDiagnosis {
  source: 'firestore_read_only';
  storeId: string;
  orderId: string;
  order: {
    status: string;
    paymentStatus: string;
    refundStatus: string;
    operationalTotalMinor: number | null;
    operationalRefundAmountMinor: number | null;
  };
  payments: {
    count: number;
    truncated: boolean;
    records: Array<{
      scope: 'erp' | 'canonical';
      status: string;
      provider: string;
      amountMinor: number | null;
    }>;
  };
  partialRefunds: {
    count: number;
    truncated: boolean;
    confirmedCount: number;
    confirmedAmountMinor: number;
    unresolvedCount: number;
    statusCounts: Record<string, number>;
  };
  blockers: string[];
  notice: string;
}

/**
 * Owner-only, bounded, Firestore-only diagnostics. Does not call Mercado Pago
 * or change orders, payments, credits, refund records or their statuses.
 * Provider state must be independently reconciled before financial action.
 */
export const diagnoseOrderRefundReadOnly = async (input: {
  storeId: string;
  orderId: string;
}): Promise<OrderRefundReadOnlyDiagnosis> => {
  const { storeId, orderId } = input;
  if (!validId(storeId) || !validId(orderId)) {
    throw new Error('PAYMENT_REFUND_DIAGNOSTIC_TARGET_INVALID');
  }
  const [orderSnap, tenantSnap] = await Promise.all([
    adminDb.doc('artifacts/' + storeId + '/public/data/customerOrders/' + orderId).get(),
    adminDb.doc('tenants/' + storeId).get(),
  ]);
  const order = orderSnap.data();
  if (!orderSnap.exists || !order || order.storeId !== storeId ||
      (order.id && order.id !== orderId)) {
    throw new Error('PAYMENT_REFUND_DIAGNOSTIC_ORDER_NOT_FOUND');
  }

  const canonicalStoreId = tenantSnap.get('canonicalStoreId');
  const roots = [storeId];
  if (validId(canonicalStoreId) && canonicalStoreId !== storeId) roots.push(canonicalStoreId);
  const records = await Promise.all(roots.map(async (root, index) => {
    const [payments, partials] = await Promise.all([
      adminDb.collection('stores/' + root + '/payments')
        .where('orderId', '==', orderId).limit(11).get(),
      adminDb.collection('stores/' + root + '/paymentPartialRefunds')
        .where('orderId', '==', orderId).limit(51).get(),
    ]);
    return {
      scope: index === 0 ? 'erp' as const : 'canonical' as const,
      payments, partials,
    };
  }));
  const paymentCount = records.reduce((n, record) => n + record.payments.size, 0);
  const partialCount = records.reduce((n, record) => n + record.partials.size, 0);
  const paymentTruncated = records.some(record => record.payments.size >= 11);
  const partialTruncated = records.some(record => record.partials.size > 50);
  const payments = records.flatMap(record => record.payments.docs.map(doc => {
    const payment = doc.data();
    return {
      scope: record.scope,
      status: typeof payment.status === 'string' ? payment.status : 'unknown',
      provider: payment.provider === 'mercado-pago' ? 'mercado-pago' : 'other_or_unknown',
      amountMinor: positiveMinor(payment.amount),
    };
  }));
  const statusCounts: Record<string, number> = {};
  let confirmedCount = 0;
  let confirmedAmountMinor = 0;
  let unresolvedCount = 0;
  for (const record of records) {
    for (const partialDoc of record.partials.docs) {
      const partial = partialDoc.data();
      const status = typeof partial.status === 'string' && /^[a-z_]{1,30}$/.test(partial.status)
        ? partial.status : 'unknown';
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      const amount = positiveMinor(partial.amount);
      if (status === 'refunded' && amount !== null) {
        confirmedCount += 1;
        confirmedAmountMinor += amount;
      } else {
        // Failed/required/processing/invalid is not proof of no provider refund.
        unresolvedCount += 1;
      }
    }
  }

  const blockers: string[] = [];
  if (!['rejected', 'cancelled'].includes(order.status)) blockers.push('pedido_nao_terminal');
  if (order.paymentStatus !== 'paid') blockers.push('pedido_sem_pagamento_confirmado');
  if (positiveMinor(order.total) === null) blockers.push('valor_operacional_ausente');
  if (paymentTruncated || paymentCount !== 1) blockers.push('pagamento_canonico_ambiguo_ou_ausente');
  if (payments.length === 1 && (payments[0].amountMinor === null ||
      payments[0].provider !== 'mercado-pago')) blockers.push('pagamento_canonico_invalido');
  if (partialTruncated) blockers.push('historico_parcial_acima_do_limite');
  if (unresolvedCount > 0) blockers.push('historico_parcial_incerto');
  if (confirmedCount > 0) blockers.push('reembolso_parcial_confirmado_exige_residual');
  if (records.some(record => record.scope === 'canonical' && record.partials.size > 0)) {
    blockers.push('historico_parcial_em_escopo_canonico');
  }
  if (records.some(record => record.scope === 'canonical' && record.payments.size > 0)) {
    blockers.push('pagamento_em_escopo_canonico_verificar_vinculo');
  }
  return {
    source: 'firestore_read_only', storeId, orderId,
    order: {
      status: typeof order.status === 'string' ? order.status : '',
      paymentStatus: typeof order.paymentStatus === 'string' ? order.paymentStatus : '',
      refundStatus: typeof order.refundStatus === 'string' ? order.refundStatus : '',
      operationalTotalMinor: positiveMinor(order.total),
      operationalRefundAmountMinor: positiveMinor(order.refundAmount),
    },
    payments: { count: paymentCount, truncated: paymentTruncated, records: payments },
    partialRefunds: {
      count: partialCount, truncated: partialTruncated,
      confirmedCount, confirmedAmountMinor, unresolvedCount, statusCounts,
    },
    blockers,
    notice: 'Leitura dos registros Firestore. O estado atual do Mercado Pago não foi consultado; nenhuma operação financeira foi executada.',
  };
};
