import type { User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import {
  parseCatalogCustomizationDefaults,
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
