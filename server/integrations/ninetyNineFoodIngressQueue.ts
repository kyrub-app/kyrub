import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import { parseOpenDeliveryEvent } from './openDelivery';
import { receiveNinetyNineFoodWebhook } from './ninetyNineFoodService';
import {
  decryptIntegrationSecret,
  getIntegrationMasterKey,
  integrationLookupId,
  verifyOpenDeliverySignature,
  type EncryptedSecretEnvelope,
} from './secretVault';

const PROVIDER = '99food';
const INGRESS_COLLECTION = 'integrationIngress';
const LEASE_MS = 60_000;

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
  merchantApiKey?: string;
}

interface ConnectionDocument {
  tenantId: string;
  externalStoreId: string;
  encryptedCredentials: EncryptedSecretEnvelope;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const connectionPath = (tenantId: string): string =>
  `integrationConnections/${tenantId}__${PROVIDER}`;

const lookupPath = (externalStoreId: string): string =>
  `integrationConnectionLookup/${integrationLookupId(PROVIDER, externalStoreId)}`;

const secretAad = (tenantId: string): string => `${PROVIDER}:${tenantId}`;

const ingressId = (externalStoreId: string, eventId: string): string =>
  `${PROVIDER}-${createHash('sha256')
    .update(`${externalStoreId}:${eventId}`)
    .digest('hex')}`;

const resolveConnection = async (
  externalStoreId: string
): Promise<ConnectionDocument> => {
  const lookup = await adminDb.doc(lookupPath(externalStoreId)).get();
  const tenantId = clean(lookup.data()?.tenantId);
  if (!tenantId) throw new Error('Merchant 99Food não está vinculado ao Kyrub.');
  const connection = await adminDb.doc(connectionPath(tenantId)).get();
  const data = connection.data() as Record<string, unknown> | undefined;
  if (
    !connection.exists ||
    clean(data?.externalStoreId) !== externalStoreId ||
    !data?.encryptedCredentials
  ) {
    throw new Error('Conexão 99Food inconsistente.');
  }
  return {
    tenantId,
    externalStoreId,
    encryptedCredentials: data.encryptedCredentials as EncryptedSecretEnvelope,
  };
};

const isAlreadyExistsError = (error: unknown): boolean => {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : {};
  const code = candidate.code;
  const message = typeof candidate.message === 'string'
    ? candidate.message
    : String(error);
  return code === 6 ||
    code === 'already-exists' ||
    code === 'ALREADY_EXISTS' ||
    /already exists|ALREADY_EXISTS/i.test(message);
};

export const enqueueNinetyNineFoodWebhook = async (input: {
  externalStoreId: string;
  signature: string;
  rawBody: Buffer;
  payload: unknown;
}): Promise<{ duplicate: boolean; queued: boolean; eventId: string }> => {
  if (!input.externalStoreId || !input.signature) {
    throw new Error('Cabeçalhos Open Delivery obrigatórios não foram informados.');
  }
  const event = parseOpenDeliveryEvent(input.payload);
  const connection = await resolveConnection(input.externalStoreId);
  const credentials = decryptIntegrationSecret<StoredCredentials>(
    connection.encryptedCredentials,
    getIntegrationMasterKey(),
    secretAad(connection.tenantId)
  );
  if (
    !verifyOpenDeliverySignature(
      input.rawBody,
      credentials.clientSecret,
      input.signature
    )
  ) {
    throw new Error('Assinatura HMAC da 99Food é inválida.');
  }

  const reference = adminDb.doc(
    `${INGRESS_COLLECTION}/${ingressId(input.externalStoreId, event.eventId)}`
  );
  try {
    await reference.create({
      provider: PROVIDER,
      tenantId: connection.tenantId,
      externalStoreId: input.externalStoreId,
      eventId: event.eventId,
      externalOrderId: event.orderId,
      eventType: event.eventType,
      signature: input.signature,
      rawBodyBase64: input.rawBody.toString('base64'),
      payload: input.payload,
      status: 'queued',
      attempts: 0,
      receivedAt: FieldValue.serverTimestamp(),
      availableAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { duplicate: false, queued: true, eventId: event.eventId };
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return { duplicate: true, queued: false, eventId: event.eventId };
    }
    throw error;
  }
};

const reserveIngress = async (
  referencePath: string
): Promise<Record<string, unknown> | null> => {
  const reference = adminDb.doc(referencePath);
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data() as Record<string, unknown> | undefined;
    if (!snapshot.exists || !data) return null;
    const status = clean(data.status);
    if (status === 'processed') return null;
    const lease = data.leaseExpiresAt;
    if (
      status === 'processing' &&
      lease instanceof Timestamp &&
      lease.toMillis() > Date.now()
    ) {
      return null;
    }
    const nextAttemptAt = data.nextAttemptAt;
    if (
      nextAttemptAt instanceof Timestamp &&
      nextAttemptAt.toMillis() > Date.now()
    ) {
      return null;
    }
    const leaseExpiresAt = Timestamp.fromMillis(Date.now() + LEASE_MS);
    transaction.update(reference, {
      status: 'processing',
      attempts: FieldValue.increment(1),
      leaseExpiresAt,
      availableAt: leaseExpiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return data;
  });
};

export const drainNinetyNineFoodIngressQueue = async (
  limit = 100
): Promise<{ checked: number; processed: number; failed: number }> => {
  const snapshot = await adminDb
    .collection(INGRESS_COLLECTION)
    .where('availableAt', '<=', Timestamp.now())
    .orderBy('availableAt', 'asc')
    .limit(Math.max(1, Math.min(250, limit)))
    .get();
  let checked = 0;
  let processed = 0;
  let failed = 0;

  for (const document of snapshot.docs) {
    const current = document.data() as Record<string, unknown>;
    if (clean(current.provider) !== PROVIDER) continue;
    if (!['queued', 'failed', 'processing'].includes(clean(current.status))) continue;
    checked += 1;
    const reserved = await reserveIngress(document.ref.path);
    if (!reserved) continue;

    try {
      const rawBodyBase64 = clean(reserved.rawBodyBase64);
      const signature = clean(reserved.signature);
      const externalStoreId = clean(reserved.externalStoreId);
      if (!rawBodyBase64 || !signature || !externalStoreId) {
        throw new Error('Evento de entrada 99Food incompleto.');
      }
      await receiveNinetyNineFoodWebhook({
        externalStoreId,
        signature,
        rawBody: Buffer.from(rawBodyBase64, 'base64'),
        payload: reserved.payload,
      });
      await document.ref.update({
        status: 'processed',
        processedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: FieldValue.delete(),
        nextAttemptAt: FieldValue.delete(),
        availableAt: FieldValue.delete(),
        error: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      const attempts = Number(reserved.attempts ?? 0) + 1;
      const backoffMs = Math.min(15 * 60_000, 15_000 * 2 ** Math.min(6, attempts));
      const nextAttemptAt = Timestamp.fromMillis(Date.now() + backoffMs);
      await document.ref.update({
        status: 'failed',
        error: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
        failedAt: FieldValue.serverTimestamp(),
        nextAttemptAt,
        availableAt: nextAttemptAt,
        leaseExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  return { checked, processed, failed };
};
