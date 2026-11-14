import type { Firestore } from 'firebase-admin/firestore';
import { recordVerifiedFirstLoginInTransaction } from './firstLoginReceiptWriter.js';

/**
 * Adapter for an independently deployed Firebase Auth user-creation trigger.
 * NEVER expose this function through HTTP or call it from a browser.
 * The eventId must come from the trusted trigger context, not request data.
 *
 * Deployment and trigger registration are intentionally outside this module.
 */
export const recordWelcomeRegistrationFromTrustedAuthTrigger = async (
  db: Firestore,
  event: {
    uid: string;
    metadata?: { creationTime?: string };
    providerData?: Array<{ providerId?: string }>;
  },
  context: { eventId: string; projectId: string },
): Promise<{ recorded: boolean }> => {
  const expectedProjectId = process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID?.trim();
  if (!expectedProjectId || context.projectId !== expectedProjectId) {
    throw Error('WELCOME_AUTH_TRIGGER_PROJECT_MISMATCH');
  }
  if (!event.providerData?.some(provider => provider.providerId === 'google.com')) {
    throw Error('WELCOME_AUTH_TRIGGER_GOOGLE_PROVIDER_REQUIRED');
  }
  if (!event.metadata?.creationTime || !Number.isFinite(Date.parse(event.metadata.creationTime))) {
    throw Error('WELCOME_AUTH_TRIGGER_CREATED_AT_INVALID');
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(context.eventId)) {
    throw Error('WELCOME_AUTH_TRIGGER_EVENT_ID_INVALID');
  }
  const createdAt = new Date(event.metadata.creationTime).toISOString();
  const receiptRef = db.doc(`users/${event.uid}/authEvents/first_login_v1`);
  return db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: event.uid,
    firebaseCreatedAt: createdAt,
    occurredAt: createdAt,
    trustedFirstLoginEvent: true,
    sourceEventId: context.eventId,
    receiptRef,
  }));
};
