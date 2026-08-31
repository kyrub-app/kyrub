import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  MERCADO_LIVRE_PLATFORM_ENVIRONMENT,
  MERCADO_LIVRE_PLATFORM_PROVIDER_ID,
  assertMercadoLivrePlatformCredentialInput,
} from '../../shared/mercadoLivrePlatformCredential.js';
import type { KyrubStoreConnection } from '../../shared/storeConnections.js';
import { resolvePlatformCredentials } from './platformCredentialStore.js';

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const catalogTopics = new Set(['items', 'items_prices']);

export interface MercadoLivreNotificationEnvelope {
  notificationId: string;
  resource: string;
  externalAccountId: string;
  topic: string;
  applicationId: string;
  attempts: number;
  sentAt: string;
}

export interface MercadoLivreNotificationIngestResult {
  accepted: boolean;
  duplicate: boolean;
  disposition: 'pending_fetch' | 'ignored_topic' | 'ignored_application' | 'unbound_account';
}

const parsePositiveInteger = (value: unknown, code: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code);
  return parsed;
};

export const parseMercadoLivreNotification = (
  value: unknown
): MercadoLivreNotificationEnvelope => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_INVALID');
  }
  const payload = value as Record<string, unknown>;
  const notificationId = clean(payload._id);
  const resource = clean(payload.resource);
  const externalAccountId = clean(payload.user_id);
  const topic = clean(payload.topic);
  const applicationId = clean(payload.application_id);
  const sentAt = clean(payload.sent);
  if (!notificationId || notificationId.length > 200) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_ID_INVALID');
  }
  if (!resource || resource.length > 500 || !resource.startsWith('/')) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_RESOURCE_INVALID');
  }
  if (!externalAccountId || externalAccountId.length > 80) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_ACCOUNT_INVALID');
  }
  if (!topic || topic.length > 80) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_TOPIC_INVALID');
  }
  if (!applicationId || applicationId.length > 80) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_APPLICATION_INVALID');
  }
  if (sentAt && !Number.isFinite(Date.parse(sentAt))) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_SENT_AT_INVALID');
  }
  return {
    notificationId,
    resource,
    externalAccountId,
    topic,
    applicationId,
    attempts: parsePositiveInteger(payload.attempts ?? 0, 'MERCADO_LIVRE_NOTIFICATION_ATTEMPTS_INVALID'),
    sentAt,
  };
};

const resolveConfiguredApplicationId = async (): Promise<string> => {
  const stored = await resolvePlatformCredentials(
    MERCADO_LIVRE_PLATFORM_PROVIDER_ID,
    MERCADO_LIVRE_PLATFORM_ENVIRONMENT
  );
  if (!stored) throw new Error('MERCADO_LIVRE_PLATFORM_NOT_CONFIGURED');
  return assertMercadoLivrePlatformCredentialInput({
    clientId: stored.client_id,
    clientSecret: stored.client_secret,
    redirectUri: stored.redirect_uri,
  }).clientId;
};

const resolveConnection = async (
  externalAccountId: string
): Promise<KyrubStoreConnection | null> => {
  const snapshot = await adminDb
    .collectionGroup('storeConnections')
    .where('externalAccountId', '==', externalAccountId)
    .get();

  const matches = snapshot.docs
    .map(document => document.data() as KyrubStoreConnection)
    .filter(record =>
      record.provider === 'mercado_livre' &&
      record.externalAccountId === externalAccountId &&
      record.status === 'connected' &&
      Boolean(record.storeId?.trim()) &&
      Boolean(record.id?.trim())
    );

  if (matches.length > 1) throw new Error('MERCADO_LIVRE_NOTIFICATION_ACCOUNT_AMBIGUOUS');
  return matches[0] ?? null;
};

const inboxDocumentId = (notificationId: string): string =>
  `mercado_livre__${createHash('sha256').update(notificationId).digest('hex')}`;

export const ingestMercadoLivreNotification = async (
  input: unknown
): Promise<MercadoLivreNotificationIngestResult> => {
  const notification = parseMercadoLivreNotification(input);
  const configuredApplicationId = await resolveConfiguredApplicationId();
  if (notification.applicationId !== configuredApplicationId) {
    return {
      accepted: false,
      duplicate: false,
      disposition: 'ignored_application',
    };
  }

  const connection = await resolveConnection(notification.externalAccountId);
  if (!connection) {
    return {
      accepted: true,
      duplicate: false,
      disposition: 'unbound_account',
    };
  }

  const disposition = catalogTopics.has(notification.topic) ? 'pending_fetch' : 'ignored_topic';
  const reference = adminDb.doc(`integrationWebhookInbox/${inboxDocumentId(notification.notificationId)}`);
  let duplicate = false;

  await adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(reference);
    if (existing.exists) {
      duplicate = true;
      return;
    }
    transaction.create(reference, {
      provider: 'mercado_livre',
      notificationId: notification.notificationId,
      topic: notification.topic,
      resource: notification.resource,
      externalAccountId: notification.externalAccountId,
      applicationId: notification.applicationId,
      attempts: notification.attempts,
      sentAt: notification.sentAt || null,
      storeId: connection.storeId,
      connectionId: connection.id,
      disposition,
      processingStatus: disposition === 'pending_fetch' ? 'pending' : 'ignored',
      authority: 'provider_notification_trigger',
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    accepted: true,
    duplicate,
    disposition,
  };
};
