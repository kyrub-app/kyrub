import { adminDb } from '../firebaseAdmin.js';
import {
  OpenDeliveryClient,
  type NormalizedIntegrationOrder,
  type OpenDeliveryConnectionRuntime,
  type OpenDeliveryCredentials,
  type OpenDeliveryEvent,
} from './openDelivery.js';
import {
  decryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from './secretVault.js';

const PROVIDER = '99food' as const;
const CONNECTION_COLLECTION = 'integrationConnections';

interface StoredCredentials extends OpenDeliveryCredentials {
  merchantApiKey: string;
}

interface ReadConnection {
  provider: typeof PROVIDER;
  tenantId: string;
  externalStoreId: string;
  routingTarget: string;
  baseUrl: string;
  tokenUrl: string;
  status: 'connected' | 'attention' | 'disabled';
  encryptedCredentials: EncryptedSecretEnvelope;
}

export type NinetyNineFoodProviderReconciliationObservation = {
  outcome: 'confirmed' | 'not_observed' | 'conflict' | 'uncertain';
  providerLastEvent: string;
  providerStatus: string;
  warning: string;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const connectionId = (tenantId: string): string => `${tenantId}__${PROVIDER}`;
const connectionPath = (tenantId: string): string =>
  `${CONNECTION_COLLECTION}/${connectionId(tenantId)}`;
const secretAad = (tenantId: string): string => `${PROVIDER}:${tenantId}`;

const parseConnection = (value: unknown): ReadConnection | null => {
  const candidate = record(value);
  if (
    candidate.provider !== PROVIDER ||
    !clean(candidate.tenantId) ||
    !clean(candidate.externalStoreId) ||
    !clean(candidate.routingTarget) ||
    !clean(candidate.baseUrl) ||
    !clean(candidate.tokenUrl) ||
    !candidate.encryptedCredentials ||
    typeof candidate.encryptedCredentials !== 'object'
  ) {
    return null;
  }
  return candidate as unknown as ReadConnection;
};

const runtimeFor = (connection: ReadConnection): OpenDeliveryConnectionRuntime => {
  const credentials = decryptIntegrationSecret<StoredCredentials>(
    connection.encryptedCredentials,
    getIntegrationMasterKey(),
    secretAad(connection.tenantId)
  );
  return {
    connectionId: connectionId(connection.tenantId),
    tenantId: connection.tenantId,
    externalStoreId: connection.externalStoreId,
    baseUrl: connection.baseUrl,
    tokenUrl: connection.tokenUrl,
    routingTarget: connection.routingTarget,
    credentials,
  };
};

const PROGRESSION_RANK: Record<string, number> = {
  CREATED: 0,
  CONFIRMED: 1,
  PREPARATION_REQUESTED: 1,
  PREPARING: 2,
  READY_FOR_PICKUP: 3,
  PICKUP_AREA_ASSIGNED: 3,
  DISPATCHED: 4,
  PICKED_UP: 4,
  DELIVERED: 5,
  CONCLUDED: 5,
};

const TARGET_RANK: Partial<Record<NormalizedIntegrationOrder['status'], number>> = {
  accepted: 1,
  preparing: 2,
  ready: 3,
  out_for_delivery: 4,
  completed: 5,
};

const CANCELLATION_OBSERVED = new Set([
  'CANCELLATION_REQUESTED',
  'ORDER_CANCELLATION_REQUEST',
  'CANCELLED',
]);

const CANCELLATION_DENIED = new Set([
  'CANCELLATION_REQUEST_DENIED',
  'CANCELLED_DENIED',
]);

const providerStatusFromEvent = (eventType: string): string => {
  switch (eventType) {
    case 'CONFIRMED':
    case 'PREPARATION_REQUESTED':
      return 'accepted';
    case 'PREPARING':
      return 'preparing';
    case 'READY_FOR_PICKUP':
    case 'PICKUP_AREA_ASSIGNED':
      return 'ready';
    case 'DISPATCHED':
    case 'PICKED_UP':
      return 'out_for_delivery';
    case 'DELIVERED':
    case 'CONCLUDED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    case 'CANCELLATION_REQUESTED':
    case 'ORDER_CANCELLATION_REQUEST':
      return 'cancellation_requested';
    case 'CANCELLATION_REQUEST_DENIED':
    case 'CANCELLED_DENIED':
      return 'cancellation_denied';
    case 'CREATED':
      return 'pending';
    default:
      return '';
  }
};

const classifyObservation = (
  targetStatus: NormalizedIntegrationOrder['status'],
  providerLastEvent: string
): NinetyNineFoodProviderReconciliationObservation => {
  const providerStatus = providerStatusFromEvent(providerLastEvent);
  if (!providerLastEvent || !providerStatus) {
    return {
      outcome: 'uncertain',
      providerLastEvent,
      providerStatus,
      warning: 'A 99Food respondeu o pedido, mas não forneceu um lastEvent reconhecido. Nenhum novo envio foi realizado.',
    };
  }

  if (targetStatus === 'cancelled' || targetStatus === 'rejected') {
    if (CANCELLATION_OBSERVED.has(providerLastEvent)) {
      return {
        outcome: 'confirmed',
        providerLastEvent,
        providerStatus,
        warning: '',
      };
    }
    if (CANCELLATION_DENIED.has(providerLastEvent)) {
      return {
        outcome: 'conflict',
        providerLastEvent,
        providerStatus,
        warning: 'A 99Food registra que a solicitação de cancelamento foi negada. Nenhum novo envio foi realizado.',
      };
    }
    return {
      outcome: 'not_observed',
      providerLastEvent,
      providerStatus,
      warning: 'A leitura atual da 99Food não mostra solicitação de cancelamento nem cancelamento aplicado. Isso não autoriza retry automático.',
    };
  }

  if (CANCELLATION_OBSERVED.has(providerLastEvent) || CANCELLATION_DENIED.has(providerLastEvent)) {
    return {
      outcome: 'conflict',
      providerLastEvent,
      providerStatus,
      warning: 'O estado atual da 99Food está em um fluxo de cancelamento incompatível com o status que estava sendo sincronizado. Nenhum novo envio foi realizado.',
    };
  }

  const targetRank = TARGET_RANK[targetStatus];
  const observedRank = PROGRESSION_RANK[providerLastEvent];
  if (typeof targetRank !== 'number' || typeof observedRank !== 'number') {
    return {
      outcome: 'uncertain',
      providerLastEvent,
      providerStatus,
      warning: 'O estado retornado pela 99Food não pôde ser comparado com o status alvo. Nenhum novo envio foi realizado.',
    };
  }
  if (observedRank >= targetRank) {
    return {
      outcome: 'confirmed',
      providerLastEvent,
      providerStatus,
      warning: '',
    };
  }
  return {
    outcome: 'not_observed',
    providerLastEvent,
    providerStatus,
    warning: 'A leitura atual da 99Food ainda está anterior ao status alvo. O Kyrub não presume falha e não executa retry automático.',
  };
};

export const inspectNinetyNineFoodProviderStatusForReconciliation = async (input: {
  tenantId: string;
  executionId: string;
  externalOrderId: string;
  targetStatus: NormalizedIntegrationOrder['status'];
}): Promise<NinetyNineFoodProviderReconciliationObservation> => {
  const tenantId = clean(input.tenantId);
  const executionId = clean(input.executionId);
  const externalOrderId = clean(input.externalOrderId);
  if (!tenantId || !executionId || !externalOrderId) {
    throw new Error('Execução 99Food não identificada para leitura de reconciliação.');
  }
  const connectionSnapshot = await adminDb.doc(connectionPath(tenantId)).get();
  const connection = parseConnection(connectionSnapshot.data());
  if (!connection || connection.status === 'disabled') {
    throw new Error('A integração 99Food não está disponível para reconciliação.');
  }

  const client = new OpenDeliveryClient(runtimeFor(connection));
  const syntheticEvent: OpenDeliveryEvent = {
    eventId: `reconciliation-${executionId}`,
    eventType: 'CREATED',
    orderId: externalOrderId,
    orderURL: '',
    createdAt: new Date().toISOString(),
    sourceAppId: '',
    virtualBrand: '',
  };
  const details = record(await client.getOrder(syntheticEvent));
  const returnedOrderId = clean(details.id);
  if (returnedOrderId && returnedOrderId !== externalOrderId) {
    return {
      outcome: 'uncertain',
      providerLastEvent: clean(details.lastEvent),
      providerStatus: '',
      warning: 'A 99Food respondeu com um identificador de pedido diferente. A execução permanece bloqueada para revisão manual.',
    };
  }
  return classifyObservation(input.targetStatus, clean(details.lastEvent));
};
