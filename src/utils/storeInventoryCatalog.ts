import type { User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import {
  getProductInventoryDocumentPath,
  parseInventoryCatalog,
  readProductInventorySettings,
  type ProductComposition,
} from './productInventory';
import { applyCatalogMutation, type CatalogMutation } from './storeInventoryCatalogMutation';

export const persistStoreInventoryCatalog = async (
  user: Pick<User, 'uid'>,
  mutation: CatalogMutation
): Promise<void> => {
  const reference = doc(db, getProductInventoryDocumentPath(user.uid));

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const current = readProductInventorySettings(snapshot.data());
    const next = applyCatalogMutation(current.catalog, mutation);
    const normalizedCatalog = parseInventoryCatalog(next);
    if (normalizedCatalog.length !== next.length) {
      throw new Error('Revise os dados dos itens de estoque antes de salvar.');
    }

    // Only deletion changes compositions, and only for the confirmed item.
    const compositions: Record<string, ProductComposition> = {};
    if (mutation.kind === 'remove') {
      for (const [productId, composition] of Object.entries(current.compositions)) {
        const lines = composition.lines.filter(line => line.inventoryItemId !== mutation.expected.id);
        if (lines.length > 0) compositions[productId] = { ...composition, lines };
      }
    }
    const data = {
      ownerId: user.uid,
      inventoryCatalog: normalizedCatalog,
      catalog: normalizedCatalog,
      ...(mutation.kind === 'remove' ? { productCompositions: compositions, compositions } : {}),
      updatedAt: serverTimestamp(),
      ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
    };
    // Replace whole top-level maps on deletion (nested merge would retain removed keys).
    transaction.set(reference, data, { mergeFields: Object.keys(data) });
  });
};
