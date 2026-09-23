import type { FiscalHomologationDocumentFamily, FiscalHomologationOperationScope } from './fiscalHomologationPolicy';

export type FiscalExecutableDocumentStatus =
  | 'blocked_explicit_tax_policy_required'
  | 'ready';

export interface FiscalGoodsProfileSnapshot {
  kind: 'goods';
  fiscalDescription: string;
  ncm: string;
  cest: string;
  gtin: string;
  noGtin: boolean;
  commercialUnit: string;
  taxUnit: string;
  conversionFactor: number;
  origin: string;
}

export interface FiscalServiceProfileSnapshot {
  kind: 'service';
  fiscalDescription: string;
  serviceListCode: string;
  municipalServiceCode: string;
  nbs: string;
}

export type FiscalProductProfileSnapshot =
  | FiscalGoodsProfileSnapshot
  | FiscalServiceProfileSnapshot;

export interface FiscalDocumentLineSnapshot {
  lineId: string;
  productId: string;
  productName: string;
  kind: 'goods' | 'service';
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  fiscalProfile: FiscalProductProfileSnapshot;
}

export interface FiscalIdentityFingerprintSnapshot {
  issuerTaxIdentifierHash: string;
  consumerTaxIdentifierHash: string | null;
}

export interface FiscalTaxExecutionPolicyBinding {
  status: 'required' | 'bound';
  policyId: string | null;
  version: number | null;
}

export interface FiscalExecutableDocumentSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  evidenceFingerprint: string;
  canonicalStoreId: string;
  attemptId: string;
  orderId: string;
  documentFamily: FiscalHomologationDocumentFamily;
  operationScope: FiscalHomologationOperationScope;
  environment: 'sandbox';
  lines: FiscalDocumentLineSnapshot[];
  subtotal: number;
  discountTotal: number;
  documentTotal: number;
  identityFingerprints: FiscalIdentityFingerprintSnapshot;
  taxExecutionPolicy: FiscalTaxExecutionPolicyBinding;
  status: FiscalExecutableDocumentStatus;
  createdAt: string;
  authority: 'kyrub_canonical_fiscal_document_snapshot';
}

export const isFiscalExecutableDocumentReady = (
  snapshot: FiscalExecutableDocumentSnapshot
): boolean =>
  snapshot.status === 'ready' &&
  snapshot.taxExecutionPolicy.status === 'bound' &&
  Boolean(snapshot.taxExecutionPolicy.policyId) &&
  typeof snapshot.taxExecutionPolicy.version === 'number';
