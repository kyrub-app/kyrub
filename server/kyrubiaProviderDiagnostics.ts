import { FieldValue } from 'firebase-admin/firestore';
import type { KyrubiaProviderDiagnostic } from '../shared/kyrubiaProviderDiagnostics.js';
import { adminDb } from './firebaseAdmin.js';

export type RecordKyrubiaProviderCallInput = {
  uid: string;
  requestId: string;
  callIndex: number;
  provider: 'google-gemini';
  model: string;
  route: 'primary' | 'economy' | 'followup';
  fallbackUsed: boolean;
  durationMs: number;
  diagnostic: KyrubiaProviderDiagnostic;
};

const safeIdentifier = (value: string, maximum = 160): string =>
  value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maximum);

export const recordKyrubiaProviderCall = async (
  input: RecordKyrubiaProviderCallInput
): Promise<void> => {
  const uid = safeIdentifier(input.uid, 128);
  const requestId = safeIdentifier(input.requestId, 160);
  const model = input.model.trim().slice(0, 120);
  if (!uid || !requestId || !model) return;

  const callIndex = Number.isSafeInteger(input.callIndex) && input.callIndex > 0
    ? input.callIndex
    : 1;
  const eventId = `${requestId}_${callIndex}_provider`;

  await adminDb.collection('kyrub_ai_provider_events').doc(eventId).set({
    schemaVersion: 1,
    id: eventId,
    uid,
    resource: 'ai_provider_call',
    provider: input.provider,
    requestId,
    callIndex,
    model,
    route: input.route,
    fallbackUsed: input.fallbackUsed === true,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    outcome: input.diagnostic.outcome,
    failureClass: input.diagnostic.failureClass,
    httpStatus: input.diagnostic.httpStatus,
    providerStatus: input.diagnostic.providerStatus,
    providerCode: input.diagnostic.providerCode,
    retryable: input.diagnostic.retryable,
    retryDelay: input.diagnostic.retryDelay,
    quotaMetrics: input.diagnostic.quotaMetrics,
    quotaIds: input.diagnostic.quotaIds,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: false });
};
