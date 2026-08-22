import { FieldValue } from 'firebase-admin/firestore';
import {
  calculateCompositionAvailableStock,
  parseInventoryCatalogRecords,
  parseInventoryCompositionRecords,
  type InventoryCatalogRecord,
} from '../../shared/inventoryConsumption.js';
import { adminDb } from '../firebaseAdmin.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export interface DerivedProductStockPatch {
  productId: string;
  stock: number;
}

export const deriveProductStockPatches = (
  publicProducts: unknown,
  catalog: InventoryCatalogRecord[],
  compositions: ReturnType<typeof parseInventoryCompositionRecords>
): DerivedProductStockPatch[] => {
  if (!Array.isArray(publicProducts)) return [];

  return publicProducts.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const product = candidate as Record<string, unknown>;
    const productId = clean(product.id);
    if (!productId || product.isService === true) return [];

    const available = calculateCompositionAvailableStock(
      catalog,
      compositions[productId]
    );
    return available === null
      ? []
      : [{ productId, stock: available } satisfies DerivedProductStockPatch];
  });
};

export const applyDerivedStockToPublicProducts = (
  publicProducts: unknown,
  patches: DerivedProductStockPatch[]
): unknown[] | null => {
  if (!Array.isArray(publicProducts)) return null;
  if (patches.length === 0) return [...publicProducts];

  const stockByProductId = new Map(
    patches.map(patch => [patch.productId, patch.stock])
  );
  return publicProducts.map(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return candidate;
    }
    const product = candidate as Record<string, unknown>;
    const productId = clean(product.id);
    const stock = stockByProductId.get(productId);
    return stock === undefined ? product : { ...product, stock };
  });
};

export const reconcileDerivedProductStockForTenant = async (
  tenantIdValue: string
): Promise<DerivedProductStockPatch[]> => {
  const tenantId = clean(tenantIdValue);
  if (!tenantId) return [];

  return adminDb.runTransaction(async transaction => {
    const tenantReference = adminDb.doc(`tenants/${tenantId}`);
    const inventoryReference = adminDb.doc(
      `users/${tenantId}/private_store/inventory`
    );
    const [tenantSnapshot, inventorySnapshot] = await Promise.all([
      transaction.get(tenantReference),
      transaction.get(inventoryReference),
    ]);

    if (!tenantSnapshot.exists || !inventorySnapshot.exists) return [];

    const tenantData = tenantSnapshot.data();
    const inventoryData = inventorySnapshot.data();
    const catalog = parseInventoryCatalogRecords(
      inventoryData?.catalog ?? inventoryData?.inventoryCatalog
    );
    const compositions = parseInventoryCompositionRecords(
      inventoryData?.compositions ?? inventoryData?.productCompositions
    );
    const patches = deriveProductStockPatches(
      tenantData?.publicProducts,
      catalog,
      compositions
    );
    if (patches.length === 0) return [];

    const canonicalStoreId = clean(tenantData?.canonicalStoreId);
    const canonicalReferences = canonicalStoreId
      ? patches.map(patch =>
          adminDb.doc(`stores/${canonicalStoreId}/products/${patch.productId}`)
        )
      : [];
    const canonicalSnapshots = await Promise.all(
      canonicalReferences.map(reference => transaction.get(reference))
    );

    const publicProducts = applyDerivedStockToPublicProducts(
      tenantData?.publicProducts,
      patches
    );
    if (publicProducts) {
      transaction.set(
        tenantReference,
        {
          publicProducts,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    canonicalSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const patch = patches[index];
      if (!patch) return;
      transaction.update(snapshot.ref, {
        stock: patch.stock,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return patches;
  });
};
