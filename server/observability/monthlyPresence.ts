import { createHmac } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

// Candidate primitive only: no endpoint, environment activation or global DB.
// The caller must authenticate, qualify activity and supply a trusted clock.
export interface MonthlyPresenceMarker {
  schemaVersion: 1;
  month: string;
}
export interface MonthlyPresenceStore {
  create(path: string, marker: MonthlyPresenceMarker): Promise<void>;
}
export interface MonthlyPresenceInput {
  authenticatedUid: string;
  projectId: string;
  qualifiedActivity: boolean;
  receivedAt: Date;
}

const monthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
});
export function presenceMonth(receivedAt: Date): string {
  if (!Number.isFinite(receivedAt.getTime())) throw Error('MAU_INVALID_CLOCK');
  const parts = monthFormatter.formatToParts(receivedAt);
  const year = parts.find(x => x.type === 'year')?.value;
  const month = parts.find(x => x.type === 'month')?.value;
  if (!year || !/^\d{4}$/.test(year) || !month || !/^(0[1-9]|1[0-2])$/.test(month))
    throw Error('MAU_INVALID_MONTH');
  return year + '-' + month;
}

export function monthlyPresencePath(input: MonthlyPresenceInput, secret: Uint8Array): string {
  if (!input.authenticatedUid || input.authenticatedUid.length > 128 ||
      !input.authenticatedUid.trim() || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.projectId) ||
      secret.byteLength < 32) throw Error('MAU_INVALID_IDENTITY_OR_KEY');
  const month = presenceMonth(input.receivedAt);
  const id = createHmac('sha256', secret)
    .update(JSON.stringify(['kyrub-finops-mau-v1', input.projectId, month, input.authenticatedUid]))
    .digest('hex');
  return 'kyrub_finops_mau_months/' + month + '/markers/' + id;
}

export async function confirmMonthlyPresence(
  input: MonthlyPresenceInput, secret: Uint8Array, store: MonthlyPresenceStore,
): Promise<{status: 'created' | 'already_counted' | 'not_qualified'; month: string}> {
  const month = presenceMonth(input.receivedAt);
  if (!input.qualifiedActivity) return {status:'not_qualified', month};
  const path = monthlyPresencePath(input, secret);
  try {
    await store.create(path, {schemaVersion:1, month});
    return {status:'created', month};
  } catch (error) {
    const code = (error as {code?: unknown} | null)?.code;
    // Only an atomic create precondition conflict is a valid replay.
    if (code === 6 || code === 'ALREADY_EXISTS') return {status:'already_counted', month};
    throw error;
  }
}

// Explicit injection: never initialize Admin SDK or select a project here.
export function firestoreMonthlyPresenceStore(db: Pick<Firestore, 'doc'>): MonthlyPresenceStore {
  return {create: async (path, marker) => { await db.doc(path).create(marker); }};
}
