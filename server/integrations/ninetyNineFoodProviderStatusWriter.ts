import { adminDb } from '../firebaseAdmin.js';
import {
  OpenDeliveryClient,
  buildOpenDeliveryAction,
  type NormalizedIntegrationOrder,
  type OpenDeliveryConnectionRuntime,
  type OpenDeliveryCredentials,
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

interface StatusWriteConnection {
  provider: typeof PROVIDER;
  tenantId: string;
  externalStoreId: string;
  routingTarget: string;
  baseUrl: string;
  tokenUrl: string;
  status: 'connected' | 'attention' | 'disabled';
  encryptedCredentials: EncryptedSecretEnvelope;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const connectionId = (tenantId: string): string => `${tenantId}__${PROVIDER}`;
const connectionPath = (tenantId: string): string =>
  `${CONNECTION_COLLECTION}/${connectionId(tenantId)}`;
const secretAad = (tenantId: string): string => `${PROVIDER}:${tenantId}`;

const parseConnection = (value: unknown): StatusWriteConnection | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
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
  return candidate as unknown as StatusWriteConnection;
};

const runtimeFor = (connection: StatusWriteConnection): OpenDeliveryConnectionRuntime => {
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

export const writeNinetyNineFoodOrderStatusToProvider = async (input: {
  tenantId: string;
  orderId: string;
  externalOrderId: string;
  status: NormalizedIntegrationOrder['status'];
  reason?: string;
}): Promise<void> => {
  const tenantId = clean(input.tenantId);
  const orderId = clean(input.orderId);
  const externalOrderId = clean(input.externalOrderId);
  if (!tenantId || !orderId || !externalOrderId) {
    throw new Error('Pedido 99Food não identificado para escrita externa.');
  }

  const [connectionSnapshot, orderSnapshot] = await Promise.all([
    adminDb.doc(connectionPath(tenantId)).get(),
    adminDb.doc(`artifacts/${tenantId}/public/data/customerOrders/${orderId}`).get(),
  ]);
  const connection = parseConnection(connectionSnapshot.data());
  if (!connection || connection.status === 'disabled') {
    throw new Error('A integração 99Food não está configurada.');
  }
  const order = orderSnapshot.data() as Record<string, unknown> | undefined;
  if (!order) throw new Error('Pedido 99Food não encontrado no Kyrub.');
  const integration =
    order.integration && typeof order.integration === 'object' && !Array.isArray(order.integration)
      ? order.integration as Record<string, unknown>
      : {};
  if (
    clean(integration.provider) !== PROVIDER ||
    clean(integration.externalOrderId) !== externalOrderId
  ) {
    throw new Error('Identidade externa 99Food do pedido mudou antes do provider write.');
  }
  if (
    clean(integration.outboundStatus) !== 'executing' ||
    clean(order.status) !== input.status
  ) {
    throw new Error('O status local do pedido mudou antes do provider write 99Food.');
  }

  const action = buildOpenDeliveryAction(externalOrderId, input.status, {
    displayId: clean(integration.displayId) || externalOrderId,
    createdAt: clean(order.createdAt) || new Date().toISOString(),
    reason: clean(input.reason),
  });
  const client = new OpenDeliveryClient(runtimeFor(connection));
  await client.sendAction(action);
};
