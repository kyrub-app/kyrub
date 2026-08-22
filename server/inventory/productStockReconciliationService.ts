import {
  FieldValue,
  type DocumentData,
  type Transaction,
} from 'firebase-admin/firestore';
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

export const reconcileDerivedProductStockInTransaction = (input: {
  transaction: Transaction;
  tenantId: string;
  tenantData: DocumentData | undefined;
  inventoryData: DocumentData | undefined;
  catalog?: InventoryCatalogRecord[];
}): DerivedProductStockPatch[] => {
  const tenantId = clean(input.tenantId);
  if (!tenantId) return [];

  const catalog = input.catalog ?? parseInventoryCatalogRecords(
    input.inventoryData?.catalog ?? input.inventoryData?.inventoryCatalog
  );
  const compositions = parseInventoryCompositionRecords(
    input.inventoryData?.compositions ?? input.inventoryData?.productCompositions
  );
  const patches = deriveProductStockPatches(
    input.tenantData?.publicProducts,
    catalog,
    compositions
  );
  if (patches.length === 0) return [];

  const publicProducts = applyDerivedStockToPublicProducts(
    input.tenantData?.publicProducts,
    patches
  );
  if (publicProducts) {
    input.transaction.set(
      adminDb.doc(`tenants/${tenantId}`),
      {
        publicProducts,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  const canonicalStoreId = clean(input.tenantData?.canonicalStoreId);
  if (canonicalStoreId) {
    for (const patch of patches) {
      input.transaction.update(
        adminDb.doc(`stores/${canonicalStoreId}/products/${patch.productId}`),
        {
          stock: patch.stock,
          updatedAt: FieldValue.serverTimestamp(),
        }
      );
    }
  }

  return patches;
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

    return reconcileDerivedProductStockInTransaction({
      transaction,
      tenantId,
      tenantData: tenantSnapshot.data(),
      inventoryData: inventorySnapshot.data(),
    });
  });
};
