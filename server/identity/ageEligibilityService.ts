import { adminAuth, adminDb, getFirebaseAdminProjectId } from '../firebaseAdmin.js';
import { screenAge, type AgeStatus } from '../../shared/ageEligibility.js';

import { ageScreeningEmulatorsReady, ageScreeningProjectId } from './ageScreeningIsolation.js';

const COLLECTION = 'age_eligibility_private';
const POLICY_VERSION = 'v1-preliminary-2026-11-25';
const VALID_STATUSES: ReadonlySet<AgeStatus> = new Set([
  'pending', 'declared_adult', 'declared_underage', 'verified_adult',
  'verified_underage', 'inconclusive', 'suspended',
]);

/** Server-only service; no HTTP transport or production activation in this PR. */
async function authenticate(authorization: string): Promise<string> {
  if (!ageScreeningEmulatorsReady(process.env) ||
      getFirebaseAdminProjectId() !== ageScreeningProjectId) throw Error('AGE_EMULATOR_REQUIRED');
  const token = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1];
  if (!token || token.length > 8192) throw Error('AGE_AUTH_REQUIRED');
  // Explicit revocation/disabled-user check. No UID is accepted from request body.
  const identity = await adminAuth.verifyIdToken(token, true);
  if (identity.email_verified !== true || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid)) {
    throw Error('AGE_AUTH_REQUIRED');
  }
  return identity.uid;
}

function civilToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return get('year') + '-' + get('month') + '-' + get('day');
}

function readStatus(data: Record<string, unknown> | undefined, uid: string): AgeStatus {
  if (data === undefined) return 'pending';
  if (data.uid !== uid || typeof data.status !== 'string' ||
      !VALID_STATUSES.has(data.status as AgeStatus)) {
    throw Error('AGE_RECORD_INVALID');
  }
  return data.status as AgeStatus;
}

export async function getOwnAgeStatus(authorization: string): Promise<{status: AgeStatus}> {
  const uid = await authenticate(authorization);
  const snapshot = await adminDb.collection(COLLECTION).doc(uid).get();
  return { status: readStatus(snapshot.data(), uid) };
}

/**
 * Initial screening only. No raw date of birth is persisted or logged.
 * Any recorded outcome requires a separate trusted correction/review workflow;
 * repeated submissions cannot overwrite a minor, verified or suspended state.
 */
export async function submitOwnAgeScreening(
  authorization: string,
  input: unknown,
): Promise<{status: AgeStatus}> {
  const uid = await authenticate(authorization);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('AGE_INPUT_INVALID');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(k => k !== 'birthDate' && k !== 'declaredAdult') ||
      typeof data.birthDate !== 'string' || data.birthDate.length !== 10 ||
      typeof data.declaredAdult !== 'boolean') throw Error('AGE_INPUT_INVALID');
  const now = new Date();
  const outcome = screenAge({
    birthDate: data.birthDate, declaredAdult: data.declaredAdult, today: civilToday(now),
  });
  const ref = adminDb.collection(COLLECTION).doc(uid);
  return adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) return { status: readStatus(snapshot.data(), uid) };
    if (outcome.status === 'pending') throw Error(outcome.reason.toUpperCase());
    tx.create(ref, {
      uid, status: outcome.status, method: 'self_declaration',
      policyVersion: POLICY_VERSION, recordedAt: now.toISOString(),
    });
    return { status: outcome.status };
  });
}
