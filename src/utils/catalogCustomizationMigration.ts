import type { User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { ProductOptionGroup } from '../types';
import { db } from './firebase';
import {
  parseCatalogCustomizationDefaults,
  upsertCatalogCustomizationDefaults,
  type CatalogCustomizationDefaults,
} from './catalogCustomizationInheritance';

/** Owner-only migration target. Never expose this document in the public storefront. */
export const getPrivateCatalogCustomizationPath = (uid: string): string =>
  `users/${uid.trim()}/private_store/catalog_customization`;

/**
 * Copies legacy defaults only when the private destination does not yet exist.
 * Idempotent: an existing destination is authoritative and is never overwritten.
 * Call only after the corresponding Firestore rules are deployed.
 */
export const migrateLegacyCatalogCustomizationDefaults = async (
  user: Pick<User, 'uid'>
): Promise<CatalogCustomizationDefaults[]> => {
  const destination = doc(db, getPrivateCatalogCustomizationPath(user.uid));
  const legacy = doc(db, 'tenants', user.uid);

  return runTransaction(db, async transaction => {
    const destinationSnapshot = await transaction.get(destination);
    if (destinationSnapshot.exists()) {
      return parseCatalogCustomizationDefaults(
        destinationSnapshot.data().catalogCustomizationDefaults
      );
    }

    const legacySnapshot = await transaction.get(legacy);
    // Do not create an empty private document for users without legacy data.
    if (!legacySnapshot.exists()) return [];
    const defaults = parseCatalogCustomizationDefaults(
      legacySnapshot.data().catalogCustomizationDefaults
    );
    if (defaults.length === 0) return [];
    if (defaults.length > 200) {
      throw new Error('Os padrões herdados excedem o limite do destino privado.');
    }
    const now = serverTimestamp();
    transaction.set(destination, {
      ownerId: user.uid,
      catalogCustomizationDefaults: defaults,
      createdAt: now,
      updatedAt: now,
    });
    return defaults;
  });
};

/**
 * Future private editor write path. Do not wire into the UI before Firebase rules
 * deployment and the storefront's public projection have been validated.
 * Requires a migrated destination; never creates an empty replacement for legacy data.
 */
export const savePrivateCatalogCustomizationDefaults = async (
  user: Pick<User, 'uid'>,
  path: string,
  patch: { quickNotes?: string[]; optionGroups?: ProductOptionGroup[] }
): Promise<CatalogCustomizationDefaults[]> => {
  const destination = doc(db, getPrivateCatalogCustomizationPath(user.uid));
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(destination);
    if (!snapshot.exists()) {
      throw new Error('Migração dos padrões do catálogo ainda não concluída.');
    }
    const current = parseCatalogCustomizationDefaults(
      snapshot.data().catalogCustomizationDefaults
    );
    const next = upsertCatalogCustomizationDefaults(current, path, patch);
    if (next.length > 200) {
      throw new Error('Limite de 200 configurações herdáveis atingido.');
    }
    transaction.update(destination, {
      catalogCustomizationDefaults: next,
      updatedAt: serverTimestamp(),
    });
    return next;
  });
};
