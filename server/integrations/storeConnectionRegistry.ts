import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  assertKyrubStoreConnection,
  assertStoreConnectionTenant,
  type KyrubCommerceChannel,
  type KyrubConnectionStatus,
  type KyrubStoreConnection,
  type KyrubSyncAuthority,
} from '../../shared/storeConnections.js';

const storeConnectionsCollectionPath = (storeId: string): string =>
  `stores/${storeId}/storeConnections`;

const storeConnectionPath = (storeId: string, connectionId: string): string =>
  `${storeConnectionsCollectionPath(storeId)}/${connectionId}`;

export interface StoreConnectionRegistryRecord extends KyrubStoreConnection {
  credentialAuthority: 'vault';
  credentialReference: string;
}

export interface PublicStoreConnectionRecord {
  id: string;
  scope: 'store';
  storeId: string;
  provider: string;
  channel: KyrubCommerceChannel;
  status: KyrubConnectionStatus;
  externalAccountId: string;
  syncAuthority: KyrubSyncAuthority;
  connectedByUserId: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
  credentialAuthority: 'vault';
}

const assertCredentialReference = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error('STORE_CONNECTION_CREDENTIAL_REFERENCE_REQUIRED');
  if (/access[_-]?token|refresh[_-]?token|secret|bearer\s/i.test(normalized)) {
    throw new Error('STORE_CONNECTION_PLAINTEXT_CREDENTIAL_FORBIDDEN');
  }
  return normalized;
};

const publicProjection = (
  expectedStoreId: string,
  record: StoreConnectionRegistryRecord
): PublicStoreConnectionRecord => {
  const connection = assertStoreConnectionTenant(expectedStoreId, record);
  return {
    id: connection.id,
    scope: 'store',
    storeId: connection.storeId,
    provider: connection.provider,
    channel: connection.channel,
    status: connection.status,
    externalAccountId: connection.externalAccountId,
    syncAuthority: connection.syncAuthority,
    connectedByUserId: connection.connectedByUserId,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    ...(connection.lastSyncedAt ? { lastSyncedAt: connection.lastSyncedAt } : {}),
    credentialAuthority: 'vault',
  };
};

export const saveStoreConnectionRegistryRecord = async (input: {
  storeId: string;
  connection: KyrubStoreConnection;
  credentialReference: string;
}): Promise<StoreConnectionRegistryRecord> => {
  const storeId = input.storeId.trim();
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const connection = assertStoreConnectionTenant(
    storeId,
    assertKyrubStoreConnection(input.connection)
  );
  const credentialReference = assertCredentialReference(input.credentialReference);
  const record: StoreConnectionRegistryRecord = {
    ...connection,
    credentialAuthority: 'vault',
    credentialReference,
  };

  await adminDb.doc(storeConnectionPath(storeId, connection.id)).set(
    {
      ...record,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return record;
};

export const getStoreConnectionRegistryRecord = async (input: {
  storeId: string;
  connectionId: string;
}): Promise<StoreConnectionRegistryRecord | null> => {
  const storeId = input.storeId.trim();
  const connectionId = input.connectionId.trim();
  if (!storeId || !connectionId) throw new Error('STORE_CONNECTION_TARGET_REQUIRED');
  const snapshot = await adminDb.doc(storeConnectionPath(storeId, connectionId)).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as StoreConnectionRegistryRecord;
  assertStoreConnectionTenant(storeId, data);
  return data;
};

export const listPublicStoreConnectionRegistry = async (
  storeIdInput: string
): Promise<PublicStoreConnectionRecord[]> => {
  const storeId = storeIdInput.trim();
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const snapshot = await adminDb.collection(storeConnectionsCollectionPath(storeId)).get();
  return snapshot.docs.map(document =>
    publicProjection(storeId, document.data() as StoreConnectionRegistryRecord)
  );
};
