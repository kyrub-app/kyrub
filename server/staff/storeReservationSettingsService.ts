import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { parseStoreMember } from '../../src/utils/storeSecurity.js';
import { resolveStaffActor } from './staffNoticeService.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const safeId = (id: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(id);

/**
 * Server-owned setting, separate from the store's ERP scheduling records.
 * Missing settings are deliberately treated as disabled. Past reservations
 * are never inferred as an active public booking offer.
 */
export const readPublicStoreReservationsEnabled = async (canonicalStoreId: string): Promise<boolean> => {
  if (!safeId(canonicalStoreId)) return false;
  const snap = await adminDb.doc('stores/' + canonicalStoreId + '/settings/reservations').get();
  return snap.get('enabled') === true;
};

/**
 * The public marketplace must resolve settings through the verified store
 * ownership mapping, not through caller-supplied tenant IDs.
 */
export const readPublishedStoreReservationsEnabled = async (
  legacyStoreId: string,
  verifiedCanonicalStoreId = ''
): Promise<boolean> => {
  if (!safeId(legacyStoreId)) return false;
  let canonicalStoreId = verifiedCanonicalStoreId;
  if (!canonicalStoreId) {
    const tenant = await adminDb.doc('tenants/' + legacyStoreId).get();
    canonicalStoreId = clean(tenant.get('canonicalStoreId'));
  }
  if (!safeId(canonicalStoreId)) return false;
  const store = await adminDb.doc('stores/' + canonicalStoreId).get();
  if (!store.exists || clean(store.get('ownerId')) !== legacyStoreId) return false;
  return readPublicStoreReservationsEnabled(canonicalStoreId);
};

export const readAuthorizedStoreReservationsEnabled = async (input: {
  authorization: string; legacyStoreId: string;
}): Promise<boolean> => {
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  return readPublicStoreReservationsEnabled(actor.canonicalStoreId);
};

export const setAuthorizedStoreReservationsEnabled = async (input: {
  authorization: string; legacyStoreId: string; enabled: unknown;
}): Promise<boolean> => {
  if (typeof input.enabled !== 'boolean') throw Error('RESERVATION_SETTINGS_INVALID');
  const actor = await resolveStaffActor(input.authorization, input.legacyStoreId);
  if (actor.role !== 'owner' && actor.role !== 'manager') throw Error('RESERVATION_SETTINGS_FORBIDDEN');
  const storeRef = adminDb.doc('stores/' + actor.canonicalStoreId);
  const settingsRef = storeRef.collection('settings').doc('reservations');
  const memberRef = adminDb.doc('stores/' + actor.canonicalStoreId + '/members/' + actor.uid);
  return adminDb.runTransaction(async tx => {
    const store = await tx.get(storeRef);
    if (!store.exists || clean(store.get('ownerId')) !== actor.legacyStoreId) {
      throw Error('RESERVATION_SETTINGS_FORBIDDEN');
    }
    if (actor.role !== 'owner') {
      const snap = await tx.get(memberRef);
      const member = parseStoreMember(snap.data());
      if (!member || member.userId !== actor.uid ||
          member.storeId !== actor.canonicalStoreId ||
          member.status !== 'active' || member.role !== 'manager') {
        throw Error('RESERVATION_SETTINGS_FORBIDDEN');
      }
    }
    const previous = await tx.get(settingsRef);
    if (previous.exists && previous.get('enabled') === input.enabled) return input.enabled as boolean;
    tx.set(settingsRef, {
      enabled: input.enabled,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      version: (Number(previous.get('version')) || 0) + 1,
    });
    return input.enabled as boolean;
  });
};
