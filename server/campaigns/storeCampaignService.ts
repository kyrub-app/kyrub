import { createHash } from 'node:crypto';
import type { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { loadStoreCrmSummary } from '../payments/storeCrmService.js';
import {
  STORE_CAMPAIGN_MAX_PREVIEW_SAMPLE,
  STORE_CAMPAIGN_SCHEMA_VERSION,
  matchesStoreCampaignSegment,
  normalizeStoreCampaignBody,
  normalizeStoreCampaignIdempotencyKey,
  normalizeStoreCampaignSegment,
  normalizeStoreCampaignTitle,
  storeCampaignDeliveryPath,
  storeCampaignPath,
  type SendStoreCampaignResult,
  type StoreCampaignAudiencePreview,
  type StoreCampaignDeliveryRecord,
  type StoreCampaignRecord,
  type StoreCampaignSegment,
} from '../../shared/storeCampaigns.js';
import { userCommunicationPreferencesPath } from '../../shared/userCommunicationPreferences.js';
import {
  buildUserNotification,
  userNotificationPath,
} from '../../shared/userNotifications.js';
import type { StoreCrmCustomerSummary } from '../../shared/storeCrm.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const campaignIdFor = (storeId: string, idempotencyKey: string): string =>
  `campaign_${hash(`${storeId}:${idempotencyKey}`).slice(0, 32)}`;

const requestFingerprintFor = (input: {
  segment: StoreCampaignSegment;
  title: string;
  body: string;
}): string => hash(JSON.stringify([input.segment, input.title, input.body]));

const hasMarketingConsent = (
  snapshot: DocumentSnapshot<DocumentData>,
  customerId: string
): boolean => {
  if (!snapshot.exists) return false;
  const data = snapshot.data() as Record<string, unknown> | undefined;
  const marketing = data?.marketing as Record<string, unknown> | undefined;
  return data?.schemaVersion === 1 &&
    clean(data.userId) === customerId &&
    marketing?.enabled === true;
};

const parseCampaign = (
  value: unknown,
  campaignId: string,
  storeId: string
): StoreCampaignRecord => {
  const data = value as Partial<StoreCampaignRecord>;
  if (
    data.schemaVersion !== STORE_CAMPAIGN_SCHEMA_VERSION ||
    data.id !== campaignId ||
    data.storeId !== storeId ||
    !clean(data.actorPrincipalId) ||
    !clean(data.title) ||
    typeof data.body !== 'string' ||
    data.status !== 'sent' ||
    !Number.isSafeInteger(data.candidateCount) ||
    !Number.isSafeInteger(data.deliveredCount) ||
    !Number.isSafeInteger(data.skippedNoMarketingConsentCount) ||
    !clean(data.idempotencyKeyHash) ||
    !clean(data.requestFingerprint) ||
    !clean(data.createdAt) ||
    !clean(data.sentAt)
  ) {
    throw new Error('STORE_CAMPAIGN_RECORD_INVALID');
  }
  normalizeStoreCampaignSegment(data.segment);
  normalizeStoreCampaignTitle(data.title);
  normalizeStoreCampaignBody(data.body);
  return data as StoreCampaignRecord;
};

const loadCandidates = async (
  storeId: string,
  segment: StoreCampaignSegment
): Promise<StoreCrmCustomerSummary[]> => {
  const crm = await loadStoreCrmSummary({ storeId });
  return crm.customers.filter(customer =>
    customer.customerId !== storeId && matchesStoreCampaignSegment(customer, segment)
  );
};

const preferenceReferences = (customerIds: string[]) =>
  customerIds.map(customerId =>
    adminDb.doc(userCommunicationPreferencesPath(customerId))
  );

export const previewStoreCampaignAudience = async (input: {
  storeId: string;
  segment: unknown;
  now?: Date;
}): Promise<StoreCampaignAudiencePreview> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_CAMPAIGN_STORE_REQUIRED');
  const segment = normalizeStoreCampaignSegment(input.segment);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('STORE_CAMPAIGN_TIME_INVALID');

  const candidates = await loadCandidates(storeId, segment);
  const refs = preferenceReferences(candidates.map(customer => customer.customerId));
  const snapshots = refs.length ? await adminDb.getAll(...refs) : [];
  const consentByCustomer = new Map<string, boolean>();
  snapshots.forEach((snapshot, index) => {
    const customerId = candidates[index]!.customerId;
    consentByCustomer.set(customerId, hasMarketingConsent(snapshot, customerId));
  });
  const marketingEligibleCount = candidates.reduce(
    (count, customer) => count + (consentByCustomer.get(customer.customerId) ? 1 : 0),
    0
  );

  return {
    schemaVersion: STORE_CAMPAIGN_SCHEMA_VERSION,
    storeId,
    segment,
    candidateCount: candidates.length,
    marketingEligibleCount,
    skippedNoMarketingConsentCount: candidates.length - marketingEligibleCount,
    sample: candidates.slice(0, STORE_CAMPAIGN_MAX_PREVIEW_SAMPLE).map(customer => ({
      customerId: customer.customerId,
      displayName: customer.displayName,
      levelLabel: customer.level.label,
      confirmedPurchases: customer.confirmedPurchases,
      pointsBalance: customer.pointsBalance,
      marketingEligible: consentByCustomer.get(customer.customerId) === true,
    })),
    generatedAt: now.toISOString(),
  };
};

export const sendStoreCampaign = async (input: {
  storeId: string;
  actorPrincipalId: string;
  segment: unknown;
  title: unknown;
  body: unknown;
  idempotencyKey: unknown;
  now?: Date;
}): Promise<SendStoreCampaignResult> => {
  const storeId = clean(input.storeId);
  const actorPrincipalId = clean(input.actorPrincipalId);
  if (!storeId) throw new Error('STORE_CAMPAIGN_STORE_REQUIRED');
  if (!actorPrincipalId) throw new Error('STORE_CAMPAIGN_ACTOR_REQUIRED');
  const segment = normalizeStoreCampaignSegment(input.segment);
  const title = normalizeStoreCampaignTitle(input.title);
  const body = normalizeStoreCampaignBody(input.body);
  const idempotencyKey = normalizeStoreCampaignIdempotencyKey(input.idempotencyKey);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('STORE_CAMPAIGN_TIME_INVALID');

  const candidates = await loadCandidates(storeId, segment);
  if (candidates.length === 0) throw new Error('STORE_CAMPAIGN_AUDIENCE_EMPTY');

  const id = campaignIdFor(storeId, idempotencyKey);
  const idempotencyKeyHash = hash(idempotencyKey);
  const requestFingerprint = requestFingerprintFor({ segment, title, body });
  const campaignRef = adminDb.doc(storeCampaignPath(storeId, id));
  const preferenceRefs = preferenceReferences(
    candidates.map(customer => customer.customerId)
  );
  const sentAt = now.toISOString();

  return adminDb.runTransaction(async transaction => {
    const existingSnapshot = await transaction.get(campaignRef);
    if (existingSnapshot.exists) {
      const existing = parseCampaign(existingSnapshot.data(), id, storeId);
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new Error('STORE_CAMPAIGN_IDEMPOTENCY_CONFLICT');
      }
      return { campaign: existing, duplicate: true };
    }

    const preferenceSnapshots = preferenceRefs.length
      ? await transaction.getAll(...preferenceRefs)
      : [];
    const consentByCustomer = new Map<string, boolean>();
    preferenceSnapshots.forEach((snapshot, index) => {
      const customerId = candidates[index]!.customerId;
      consentByCustomer.set(customerId, hasMarketingConsent(snapshot, customerId));
    });
    const deliveredCustomers = candidates.filter(
      customer => consentByCustomer.get(customer.customerId) === true
    );

    const campaign: StoreCampaignRecord = {
      schemaVersion: STORE_CAMPAIGN_SCHEMA_VERSION,
      id,
      storeId,
      actorPrincipalId,
      segment,
      title,
      body,
      status: 'sent',
      candidateCount: candidates.length,
      deliveredCount: deliveredCustomers.length,
      skippedNoMarketingConsentCount:
        candidates.length - deliveredCustomers.length,
      idempotencyKeyHash,
      requestFingerprint,
      createdAt: sentAt,
      sentAt,
    };
    transaction.set(campaignRef, campaign);

    for (const customer of candidates) {
      const eligible = consentByCustomer.get(customer.customerId) === true;
      let notificationId = '';
      if (eligible) {
        const notification = buildUserNotification({
          recipientUserId: customer.customerId,
          category: 'marketing',
          eventType: 'campaign_message',
          sourceId: `${id}_${customer.customerId}`,
          actorPrincipalId,
          title,
          body,
          target: {
            kind: 'storefront',
            storeId,
            customerId: customer.customerId,
          },
          createdAt: sentAt,
        });
        notificationId = notification.id;
        transaction.set(
          adminDb.doc(userNotificationPath(customer.customerId, notification.id)),
          notification
        );
      }

      const delivery: StoreCampaignDeliveryRecord = {
        schemaVersion: STORE_CAMPAIGN_SCHEMA_VERSION,
        campaignId: id,
        storeId,
        customerId: customer.customerId,
        status: eligible ? 'delivered' : 'skipped_no_marketing_consent',
        notificationId,
        createdAt: sentAt,
      };
      transaction.set(
        adminDb.doc(storeCampaignDeliveryPath(storeId, id, customer.customerId)),
        delivery
      );
    }

    return { campaign, duplicate: false };
  });
};

export const listStoreCampaigns = async (input: {
  storeId: string;
  limit?: number;
}): Promise<StoreCampaignRecord[]> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_CAMPAIGN_STORE_REQUIRED');
  const limit = Math.max(1, Math.min(50, input.limit ?? 20));
  const snapshot = await adminDb
    .collection(`stores/${storeId}/campaigns`)
    .orderBy('sentAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map(document =>
    parseCampaign(document.data(), document.id, storeId)
  );
};
