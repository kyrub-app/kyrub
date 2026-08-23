export type KyrubCommerceChannel =
  | 'mercado_livre'
  | 'shopee'
  | 'ifood'
  | '99food'
  | 'instagram'
  | 'erp'
  | 'other';

export type KyrubConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'invalid'
  | 'revoked'
  | 'unavailable';

export type KyrubSyncAuthority =
  | 'external_to_kyrub'
  | 'kyrub_to_external'
  | 'bidirectional'
  | 'manual_review';

interface ConnectionBase {
  id: string;
  provider: string;
  status: KyrubConnectionStatus;
  createdAt: string;
  updatedAt: string;
}

/** Platform-owned infrastructure credential/configuration. Never belongs to a merchant store. */
export interface KyrubPlatformConnection extends ConnectionBase {
  scope: 'platform';
  environment: 'sandbox' | 'production';
  capability: string;
}

/** Merchant authorization to an external sales channel. Always tenant/store scoped. */
export interface KyrubStoreConnection extends ConnectionBase {
  scope: 'store';
  storeId: string;
  channel: KyrubCommerceChannel;
  externalAccountId: string;
  syncAuthority: KyrubSyncAuthority;
  connectedByUserId: string;
  lastSyncedAt?: string;
}

export interface KyrubImportedDataProvenance {
  source:
    | 'manual'
    | 'mercado_livre'
    | 'shopee'
    | 'ifood'
    | '99food'
    | 'instagram'
    | 'erp'
    | 'csv'
    | 'ai'
    | 'other';
  externalId?: string;
  connectionId?: string;
  importedAt: string;
  lastSyncedAt?: string;
}

const required = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const assertKyrubPlatformConnection = (
  input: KyrubPlatformConnection
): KyrubPlatformConnection => {
  required(input.id, 'platformConnection.id');
  required(input.provider, 'platformConnection.provider');
  required(input.capability, 'platformConnection.capability');
  if (input.scope !== 'platform') throw new Error('PLATFORM_CONNECTION_SCOPE_INVALID');
  return input;
};

export const assertKyrubStoreConnection = (
  input: KyrubStoreConnection
): KyrubStoreConnection => {
  required(input.id, 'storeConnection.id');
  required(input.provider, 'storeConnection.provider');
  required(input.storeId, 'storeConnection.storeId');
  required(input.externalAccountId, 'storeConnection.externalAccountId');
  required(input.connectedByUserId, 'storeConnection.connectedByUserId');
  if (input.scope !== 'store') throw new Error('STORE_CONNECTION_SCOPE_INVALID');
  return input;
};

export const assertStoreConnectionTenant = (
  expectedStoreId: string,
  connection: KyrubStoreConnection
): KyrubStoreConnection => {
  assertKyrubStoreConnection(connection);
  if (connection.storeId !== expectedStoreId) {
    throw new Error('STORE_CONNECTION_TENANT_MISMATCH');
  }
  return connection;
};

export const channelsFromMerchantAnswer = (answer: string): KyrubCommerceChannel[] => {
  const normalized = answer.toLocaleLowerCase('pt-BR');
  const aliases: Array<[KyrubCommerceChannel, RegExp]> = [
    ['mercado_livre', /mercado\s*livre/],
    ['shopee', /shopee/],
    ['ifood', /i\s*food/],
    ['99food', /99\s*food/],
    ['instagram', /instagram|insta/],
    ['erp', /\berp\b/],
  ];
  return aliases.filter(([, pattern]) => pattern.test(normalized)).map(([channel]) => channel);
};
