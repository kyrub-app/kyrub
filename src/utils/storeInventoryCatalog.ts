import type { User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import {
  getProductInventoryDocumentPath,
  parseInventoryCatalog,
  parseProductComposition,
  readProductInventorySettings,
  type InventoryCatalogItem,
  type ProductComposition,
} from './productInventory';

const cleanCompositionsForCatalog = (
  compositions: Record<string, ProductComposition>,
  catalog: InventoryCatalogItem[]
): Record<string, ProductComposition> => {
  const allowedIds = new Set(catalog.map(item => item.id));
  const next: Record<string, ProductComposition> = {};

  for (const [productId, rawComposition] of Object.entries(compositions)) {
    const composition = parseProductComposition(rawComposition);
    const lines = composition.lines.filter(line =>
      allowedIds.has(line.inventoryItemId)
    );
    if (lines.length === 0) continue;
    next[productId] = { ...composition, lines };
  }

  return next;
};

export const persistStoreInventoryCatalog = async (
  user: Pick<User, 'uid'>,
  catalog: InventoryCatalogItem[]
): Promise<void> => {
  const normalizedCatalog = parseInventoryCatalog(catalog);
  if (normalizedCatalog.length !== catalog.length) {
    throw new Error('Revise os dados dos itens de estoque antes de salvar.');
  }

  const reference = doc(db, getProductInventoryDocumentPath(user.uid));

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const current = readProductInventorySettings(snapshot.data());
    const compositions = cleanCompositionsForCatalog(
      current.compositions,
      normalizedCatalog
    );

    transaction.set(
      reference,
      {
        ownerId: user.uid,
        inventoryCatalog: normalizedCatalog,
        catalog: normalizedCatalog,
        productCompositions: compositions,
        compositions,
        updatedAt: serverTimestamp(),
        ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  });
};
