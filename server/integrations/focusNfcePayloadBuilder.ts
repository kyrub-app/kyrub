import { createHash } from 'node:crypto';
import type { FiscalGoodsLineTaxRule } from '../../shared/fiscalTaxExecutionPolicy.js';
import type {
  FiscalExecutionPaymentEvidence,
  FiscalProviderExecutionEvidence,
} from './fiscalProviderExecutionEvidence.js';

const money = (value: number): number => Number(value.toFixed(2));

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const EXTRA_TAX_FACT_ALLOWLIST = new Set([
  'icms_modalidade_base_calculo',
  'icms_base_calculo',
  'icms_reducao_base_calculo',
  'icms_aliquota',
  'icms_valor',
  'icms_aliquota_credito_simples',
  'icms_valor_credito_simples',
  'pis_base_calculo',
  'pis_aliquota_porcentual',
  'pis_quantidade_vendida',
  'pis_aliquota_valor',
  'pis_valor',
  'cofins_base_calculo',
  'cofins_aliquota_porcentual',
  'cofins_quantidade_vendida',
  'cofins_aliquota_valor',
  'cofins_valor',
  'ibs_cbs_base_calculo',
  'ibs_uf_aliquota',
  'ibs_uf_aliquota_efetiva',
  'ibs_uf_valor',
  'ibs_mun_aliquota',
  'ibs_mun_aliquota_efetiva',
  'ibs_mun_valor',
  'ibs_valor_total',
  'cbs_aliquota',
  'cbs_aliquota_efetiva',
  'cbs_valor',
]);

const selectAllowedTaxFacts = (
  rule: FiscalGoodsLineTaxRule
): Record<string, string | number | boolean> => {
  const selected: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(rule.explicitTaxFacts)) {
    if (EXTRA_TAX_FACT_ALLOWLIST.has(key)) selected[key] = value;
  }
  return selected;
};

const destinationCode = (value: string): 1 | 2 | 3 => {
  if (value === 'internal') return 1;
  if (value === 'interstate') return 2;
  if (value === 'foreign') return 3;
  throw new Error('FOCUS_NFCE_DESTINATION_UNSUPPORTED');
};

const purposeCode = (value: string): 1 | 2 | 3 | 4 | 5 | 6 => {
  const map: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
    normal: 1,
    complementary: 2,
    adjustment: 3,
    return: 4,
    credit: 5,
    debit: 6,
  };
  const code = map[value];
  if (!code) throw new Error('FOCUS_NFCE_PURPOSE_UNSUPPORTED');
  return code;
};

const presenceCode = (value: string): 0 | 1 | 2 | 3 | 4 | 5 | 9 => {
  const map: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 9> = {
    not_applicable: 0,
    in_person: 1,
    internet: 2,
    telesales: 3,
    home_delivery: 4,
    offsite_in_person: 5,
    other_non_in_person: 9,
  };
  const code = map[value];
  if (code === undefined) throw new Error('FOCUS_NFCE_PRESENCE_UNSUPPORTED');
  return code;
};

const freightCode = (value: string): 0 | 1 | 2 | 3 | 4 | 9 => {
  const map: Record<string, 0 | 1 | 2 | 3 | 4 | 9> = {
    issuer: 0,
    recipient: 1,
    third_party: 2,
    issuer_own: 3,
    recipient_own: 4,
    no_freight: 9,
  };
  const code = map[value];
  if (code === undefined) throw new Error('FOCUS_NFCE_FREIGHT_UNSUPPORTED');
  return code;
};

const taxRegimeCode = (value: string): 1 | 2 | 3 | 4 => {
  const map: Record<string, 1 | 2 | 3 | 4> = {
    simples_nacional: 1,
    simples_nacional_excess: 2,
    regime_normal: 3,
    mei: 4,
  };
  const code = map[value];
  if (!code) throw new Error('FOCUS_NFCE_TAX_REGIME_UNSUPPORTED');
  return code;
};

const recipientIeCode = (value: string): 1 | 2 | 9 => {
  if (value === 'contributor') return 1;
  if (value === 'exempt') return 2;
  if (value === 'non_contributor') return 9;
  throw new Error('FOCUS_NFCE_RECIPIENT_IE_UNSUPPORTED');
};

export const focusNfcePaymentCode = (
  payment: Pick<FiscalExecutionPaymentEvidence, 'method' | 'provider'>
): '01' | '17' | '20' => {
  if (payment.method === 'cash') return '01';
  if (payment.method === 'pix' && payment.provider === 'store-pix') return '20';
  if (payment.method === 'pix' && payment.provider === 'mercado-pago') return '17';
  throw new Error('FOCUS_NFCE_PAYMENT_FORM_UNSUPPORTED');
};

const stableProductCode = (productId: string): string => {
  const cleanId = clean(productId, 128);
  if (cleanId && cleanId.length <= 60) return cleanId;
  return `kyrub${createHash('sha256').update(cleanId).digest('hex').slice(0, 48)}`;
};

const buildItems = (evidence: FiscalProviderExecutionEvidence) =>
  evidence.snapshot.lines.map((line, index) => {
    if (line.kind !== 'goods' || line.fiscalProfile.kind !== 'goods') {
      throw new Error('FOCUS_NFCE_GOODS_ONLY');
    }
    if (
      line.fiscalProfile.conversionFactor !== 1 ||
      line.fiscalProfile.commercialUnit !== line.fiscalProfile.taxUnit
    ) {
      throw new Error('FOCUS_NFCE_TAX_UNIT_CONVERSION_UNSUPPORTED');
    }
    const description = clean(line.fiscalProfile.fiscalDescription, 200);
    if (!description || description.length > 120) {
      throw new Error('FOCUS_NFCE_DESCRIPTION_INVALID');
    }
    const rule = evidence.taxPolicy.goodsRules[line.productId];
    if (!rule) throw new Error('FOCUS_NFCE_TAX_RULE_REQUIRED');

    return {
      numero_item: index + 1,
      codigo_produto: stableProductCode(line.productId),
      ...(line.fiscalProfile.noGtin || !line.fiscalProfile.gtin
        ? {}
        : { codigo_barras_comercial: line.fiscalProfile.gtin }),
      descricao: description,
      codigo_ncm: line.fiscalProfile.ncm,
      ...(line.fiscalProfile.cest ? { cest: line.fiscalProfile.cest } : {}),
      cfop: rule.cfop,
      unidade_comercial: line.fiscalProfile.commercialUnit,
      quantidade_comercial: line.quantity,
      valor_unitario_comercial: line.unitPrice,
      valor_bruto: money(line.quantity * line.unitPrice),
      ...(line.discountAmount > 0 ? { valor_desconto: line.discountAmount } : {}),
      unidade_tributavel: line.fiscalProfile.taxUnit,
      quantidade_tributavel: line.quantity,
      valor_unitario_tributavel: line.unitPrice,
      icms_origem: line.fiscalProfile.origin,
      icms_situacao_tributaria: rule.icmsSituation,
      pis_situacao_tributaria: rule.pisSituation,
      cofins_situacao_tributaria: rule.cofinsSituation,
      ibs_cbs_situacao_tributaria: rule.ibsCbsSituation,
      ibs_cbs_classificacao_tributaria: rule.ibsCbsClassification,
      ...selectAllowedTaxFacts(rule),
    };
  });

const buildPayments = (payments: FiscalExecutionPaymentEvidence[]) =>
  payments.map(payment => ({
    indicador_pagamento: 0,
    forma_pagamento: focusNfcePaymentCode(payment),
    valor_pagamento: money(payment.amount),
    ...(Number.isFinite(Date.parse(payment.paidAt))
      ? { data_pagamento: payment.paidAt }
      : {}),
  }));

export interface FocusNfcePreparedPayload {
  payload: Record<string, unknown>;
  payloadFingerprint: string;
}

const isNormalizedCnpj = (value: string): boolean =>
  /^[A-Z0-9]{12}\d{2}$/.test(value);

export const buildFocusNfcePayload = (input: {
  evidence: FiscalProviderExecutionEvidence;
  emissionAt: Date;
}): FocusNfcePreparedPayload => {
  const { evidence } = input;
  const operation = evidence.taxPolicy.operation;
  if (
    evidence.snapshot.documentFamily !== 'nfce' ||
    evidence.taxPolicy.documentFamily !== 'nfce' ||
    operation.kind !== 'goods_operation' ||
    operation.documentDirection !== 'outbound' ||
    operation.finalConsumer !== true
  ) {
    throw new Error('FOCUS_NFCE_OPERATION_UNSUPPORTED');
  }
  if (!isNormalizedCnpj(evidence.issuerTaxIdentifier)) {
    throw new Error('FOCUS_NFCE_CNPJ_ISSUER_REQUIRED');
  }
  if (Number.isNaN(input.emissionAt.getTime())) {
    throw new Error('FOCUS_NFCE_EMISSION_TIME_INVALID');
  }

  const payload: Record<string, unknown> = {
    cnpj_emitente: evidence.issuerTaxIdentifier,
    data_emissao: input.emissionAt.toISOString(),
    tipo_documento: 1,
    local_destino: destinationCode(operation.destinationLocation),
    finalidade_emissao: purposeCode(operation.purpose),
    consumidor_final: 1,
    presenca_comprador: presenceCode(operation.buyerPresence),
    ...(operation.recipientIeIndicator
      ? {
          indicador_inscricao_estadual_destinatario: recipientIeCode(
            operation.recipientIeIndicator
          ),
        }
      : {}),
    modalidade_frete: freightCode(operation.freightMode),
    natureza_operacao: operation.operationNature,
    regime_tributario_emitente: taxRegimeCode(operation.issuerTaxRegime),
    valor_produtos: evidence.snapshot.subtotal,
    valor_desconto: evidence.snapshot.discountTotal,
    valor_total: evidence.snapshot.documentTotal,
    items: buildItems(evidence),
    formas_pagamento: buildPayments(evidence.payments),
  };

  if (evidence.consumerTaxIdentifier) {
    if (/^\d{11}$/.test(evidence.consumerTaxIdentifier)) {
      payload.cpf_destinatario = evidence.consumerTaxIdentifier;
    } else if (isNormalizedCnpj(evidence.consumerTaxIdentifier)) {
      payload.cnpj_destinatario = evidence.consumerTaxIdentifier;
    } else {
      throw new Error('FOCUS_NFCE_CONSUMER_TAX_ID_INVALID');
    }
  }

  const serialized = JSON.stringify(payload);
  return {
    payload,
    payloadFingerprint: createHash('sha256').update(serialized).digest('hex'),
  };
};