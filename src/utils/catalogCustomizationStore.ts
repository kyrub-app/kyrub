import type { User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { ProductOptionGroup } from '../types';
import { db } from './firebase';
import {
  parseCatalogCustomizationDefaults,
  upsertCatalogCustomizationDefaults,
  type CatalogCustomizationDefaults,
} from './catalogCustomizationInheritance';

export const saveCatalogCustomizationDefaults = async (
  user: Pick<User, 'uid'>,
  path: string,
  patch: {
    quickNotes?: string[];
    optionGroups?: ProductOptionGroup[];
  }
): Promise<CatalogCustomizationDefaults[]> => {
  const tenantReference = doc(db, 'tenants', user.uid);

  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(tenantReference);
    if (!snapshot.exists()) {
      throw new Error('A loja não foi encontrada para salvar estes padrões.');
    }

    const current = parseCatalogCustomizationDefaults(
      snapshot.data().catalogCustomizationDefaults
    );
    const next = upsertCatalogCustomizationDefaults(current, path, patch);

    transaction.set(
      tenantReference,
      {
        catalogCustomizationDefaults: next,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return next;
  });
};
