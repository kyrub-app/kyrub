import { resolveOrderServiceLocation, type ResolvedOrderServiceLocation } from './serviceLocation.js';

export const LOCAL_SERVICE_REQUEST_SCHEMA_VERSION = 1 as const;
export type LocalServiceRequestKind = 'assistance' | 'payment_terminal';
export type LocalServiceRequestStatus = 'open' | 'acknowledged' | 'resolved' | 'cancelled';

export interface LocalServiceRequestCreateInput {
  storeId: string;
  orderId: string;
  kind: LocalServiceRequestKind;
}

export interface LocalServiceRequest {
  schemaVersion: typeof LOCAL_SERVICE_REQUEST_SCHEMA_VERSION;
  id: string;
  storeId: string;
  legacyStoreId: string;
  orderId: string;
  customerId: string;
  kind: LocalServiceRequestKind;
  status: LocalServiceRequestStatus;
  occurrence: number;
  serviceLocation: ResolvedOrderServiceLocation;
  requestedAt: string;
  updatedAt: string;
  acknowledgedAt: string;
  acknowledgedByUserId: string;
  resolvedAt: string;
  resolvedByUserId: string;
  cancelledAt: string;
}

const clean = (value: unknown, max = 220): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const finiteIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

export const isLocalServiceRequestKind = (value: unknown): value is LocalServiceRequestKind =>
  value === 'assistance' || value === 'payment_terminal';

export const localServiceRequestId = (orderIdInput: string, kind: LocalServiceRequestKind): string => {
  const orderId = clean(orderIdInput);
  if (!orderId || orderId.includes('/') || !isLocalServiceRequestKind(kind)) {
    throw new Error('LOCAL_SERVICE_REQUEST_ID_INVALID');
  }
  return `${orderId}--${kind}`;
};

export const parseLocalServiceRequestCreateInput = (value: unknown): LocalServiceRequestCreateInput => {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const storeId = clean(candidate.storeId, 180);
  const orderId = clean(candidate.orderId, 220);
  if (!storeId || !orderId || !isLocalServiceRequestKind(candidate.kind)) {
    throw new Error('LOCAL_SERVICE_REQUEST_INPUT_INVALID');
  }
  return { storeId, orderId, kind: candidate.kind };
};

export const resolveLocalServiceRequestLocation = (input: {
  serviceLocation?: unknown;
  tableCode?: unknown;
}): ResolvedOrderServiceLocation | null => {
  const record = input.serviceLocation && typeof input.serviceLocation === 'object'
    ? input.serviceLocation as Record<string, unknown>
    : null;
  const legacyLabel = record?.source === 'legacy_table_code'
    ? clean(record.label, 80)
    : '';
  return resolveOrderServiceLocation({
    serviceLocation: input.serviceLocation,
    tableCode: input.tableCode ?? legacyLabel,
  });
};

export const buildLocalServiceRequest = (input: {
  id: string;
  storeId: string;
  legacyStoreId: string;
  orderId: string;
  customerId: string;
  kind: LocalServiceRequestKind;
  serviceLocation?: unknown;
  tableCode?: unknown;
  occurrence?: number;
  requestedAt: string;
}): LocalServiceRequest => {
  const id = clean(input.id);
  const storeId = clean(input.storeId, 180);
  const legacyStoreId = clean(input.legacyStoreId, 180);
  const orderId = clean(input.orderId);
  const customerId = clean(input.customerId, 180);
  const requestedAt = clean(input.requestedAt, 80);
  const serviceLocation = resolveLocalServiceRequestLocation({
    serviceLocation: input.serviceLocation,
    tableCode: input.tableCode,
  });
  const occurrence = Number(input.occurrence ?? 1);
  if (!id || !storeId || !legacyStoreId || !orderId || !customerId || !serviceLocation ||
      !isLocalServiceRequestKind(input.kind) || !finiteIso(requestedAt) ||
      !Number.isSafeInteger(occurrence) || occurrence <= 0) {
    throw new Error('LOCAL_SERVICE_REQUEST_INVALID');
  }
  return {
    schemaVersion: LOCAL_SERVICE_REQUEST_SCHEMA_VERSION,
    id,
    storeId,
    legacyStoreId,
    orderId,
    customerId,
    kind: input.kind,
    status: 'open',
    occurrence,
    serviceLocation,
    requestedAt,
    updatedAt: requestedAt,
    acknowledgedAt: '',
    acknowledgedByUserId: '',
    resolvedAt: '',
    resolvedByUserId: '',
    cancelledAt: '',
  };
};

export const localServiceRequestKindLabel = (kind: LocalServiceRequestKind): string =>
  kind === 'payment_terminal' ? 'Solicitar maquininha' : 'Chamar atendimento';
