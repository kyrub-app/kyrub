import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  assertKyrubStoreConnection,
  assertStoreConnectionTenant,
  type KyrubStoreConnection,
} from '../../shared/storeConnections.js';

const storeConnectionPath = (storeId: string, connectionId: string): string =>
  `stores/${storeId}/storeConnections/${connectionId}`;

export interface StoreConnectionRegistryRecord extends KyrubStoreConnection {
  credentialAuthority: 'vault';
  credentialReference: string;
}

const assertCredentialReference = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error('STORE_CONNECTION_CREDENTIAL_REFERENCE_REQUIRED');
  if (/access[_-]?token|refresh[_-]?token|secret|bearer\s/i.test(normalized)) {
    throw new Error('STORE_CONNECTION_PLAINTEXT_CREDENTIAL_FORBIDDEN');
  }
  return normalized;
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
