import type { User } from 'firebase/auth';
import {
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';

export const INVENTORY_UNITS = [
  'un',
  'g',
  'kg',
  'ml',
  'l',
  'cx',
  'pct',
  'm',
  'cm',
] as const;

export type InventoryUnit = (typeof INVENTORY_UNITS)[number];
export type ProductCompositionKind = 'recipe' | 'bundle';

export interface InventoryCatalogItem {
  id: string;
  name: string;
  unit: InventoryUnit;
  currentQuantity: number;
  minimumQuantity: number;
  purchaseCost: number;
  supplier: string;
  updatedAt: string;
}

export interface ProductCompositionLine {
  inventoryItemId: string;
  quantity: number;
}

export interface ProductComposition {
  kind: ProductCompositionKind;
  yieldQuantity: number;
  lines: ProductCompositionLine[];
  updatedAt: string;
}

export interface ProductInventorySettings {
  catalog: InventoryCatalogItem[];
  compositions: Record<string, ProductComposition>;
}

export interface PurchaseListEntry {
  inventoryItemId: string;
  name: string;
  unit: InventoryUnit;
  currentQuantity: number;
  minimumQuantity: number;
  suggestedQuantity: number;
  purchaseCost: number;
  estimatedCost: number;
  supplier: string;
}

export const EMPTY_PRODUCT_COMPOSITION: ProductComposition = {
  kind: 'recipe',
  yieldQuantity: 1,
  lines: [],
  updatedAt: '',
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

const positiveNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

const validEntityId = (value: string): boolean =>
  /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export const getProductInventoryDocumentPath = (uid: string): string =>
  `users/${uid.trim()}/private_store/inventory`;

export const isInventoryUnit = (value: unknown): value is InventoryUnit =>
  typeof value === 'string' &&
  INVENTORY_UNITS.includes(value as InventoryUnit);

export const createInventoryCatalogItemId = (now = Date.now()): string => {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
    ?? Math.random().toString(36).slice(2, 14);
  return `inventory-${now}-${random}`;
};

export const parseInventoryCatalog = (
  value: unknown
): InventoryCatalogItem[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  return value.slice(0, 300).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    const id = clean(item.id);
    const name = clean(item.name);
    const currentQuantity = finiteNonNegative(item.currentQuantity);
    const minimumQuantity = finiteNonNegative(item.minimumQuantity);
    const purchaseCost = finiteNonNegative(item.purchaseCost) ?? 0;

    if (
      !validEntityId(id) ||
      seen.has(id) ||
      !name ||
      name.length > 120 ||
      !isInventoryUnit(item.unit) ||
      currentQuantity === null ||
      minimumQuantity === null
    ) {
      return [];
    }

    seen.add(id);
    return [{
      id,
      name,
      unit: item.unit,
      currentQuantity,
      minimumQuantity,
      purchaseCost,
      supplier: clean(item.supplier).slice(0, 160),
      updatedAt: clean(item.updatedAt),
    } satisfies InventoryCatalogItem];
  });
};

export const parseProductComposition = (
  value: unknown
): ProductComposition => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...EMPTY_PRODUCT_COMPOSITION, lines: [] };
  }

  const candidate = value as Record<string, unknown>;
  const kind: ProductCompositionKind = candidate.kind === 'bundle'
    ? 'bundle'
    : 'recipe';
  const parsedYield = positiveNumber(candidate.yieldQuantity);
  const lines = Array.isArray(candidate.lines)
    ? candidate.lines.slice(0, 40).flatMap(line => {
        if (!line || typeof line !== 'object') return [];
        const record = line as Record<string, unknown>;
        const inventoryItemId = clean(record.inventoryItemId);
        const quantity = positiveNumber(record.quantity);
        if (!validEntityId(inventoryItemId) || quantity === null) return [];
        return [{ inventoryItemId, quantity } satisfies ProductCompositionLine];
      })
    : [];

  const uniqueLines = [...new Map(
    lines.map(line => [line.inventoryItemId, line] as const)
  ).values()];

  return {
    kind,
    yieldQuantity: Math.max(1, Math.trunc(parsedYield ?? 1)),
    lines: uniqueLines,
    updatedAt: clean(candidate.updatedAt),
  };
};

export const parseProductCompositions = (
  value: unknown
): Record<string, ProductComposition> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: Record<string, ProductComposition> = {};

  for (const [productId, composition] of Object.entries(
    value as Record<string, unknown>
  )) {
    const normalizedProductId = clean(productId);
    if (!validEntityId(normalizedProductId)) continue;
    const nextComposition = parseProductComposition(composition);
    if (nextComposition.lines.length === 0) continue;
    parsed[normalizedProductId] = nextComposition;
  }

  return parsed;
};

export const readProductInventorySettings = (
  value: DocumentData | undefined
): ProductInventorySettings => ({
  catalog: parseInventoryCatalog(value?.inventoryCatalog),
  compositions: parseProductCompositions(value?.productCompositions),
});

export const calculateProductAvailableStock = (
  catalog: InventoryCatalogItem[],
  composition: ProductComposition
): number | null => {
  const parsedComposition = parseProductComposition(composition);
  if (parsedComposition.lines.length === 0) return null;

  const catalogById = new Map(catalog.map(item => [item.id, item]));
  let availableBatches = Number.POSITIVE_INFINITY;

  for (const line of parsedComposition.lines) {
    const item = catalogById.get(line.inventoryItemId);
    if (!item) return 0;
    availableBatches = Math.min(
      availableBatches,
      Math.floor(item.currentQuantity / line.quantity)
    );
  }

  if (!Number.isFinite(availableBatches)) return 0;
  return Math.max(0, availableBatches * parsedComposition.yieldQuantity);
};

export const buildInventoryPurchaseList = (
  catalog: InventoryCatalogItem[]
): PurchaseListEntry[] =>
  parseInventoryCatalog(catalog)
    .flatMap(item => {
      const suggestedQuantity = Math.max(
        0,
        item.minimumQuantity - item.currentQuantity
      );
      if (suggestedQuantity <= 0) return [];
      return [{
        inventoryItemId: item.id,
        name: item.name,
        unit: item.unit,
        currentQuantity: item.currentQuantity,
        minimumQuantity: item.minimumQuantity,
        suggestedQuantity,
        purchaseCost: item.purchaseCost,
        estimatedCost: suggestedQuantity * item.purchaseCost,
        supplier: item.supplier,
      } satisfies PurchaseListEntry];
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

const cleanCompositionsAgainstCatalog = (
  compositions: Record<string, ProductComposition>,
  catalog: InventoryCatalogItem[]
): Record<string, ProductComposition> => {
  const allowedItemIds = new Set(catalog.map(item => item.id));
  const cleaned: Record<string, ProductComposition> = {};

  for (const [productId, composition] of Object.entries(compositions)) {
    const parsedComposition = parseProductComposition(composition);
    const nextComposition = {
      ...parsedComposition,
      lines: parsedComposition.lines.filter(line =>
        allowedItemIds.has(line.inventoryItemId)
      ),
    };
    if (nextComposition.lines.length > 0) cleaned[productId] = nextComposition;
  }

  return cleaned;
};

export const persistProductInventorySettings = async (
  user: Pick<User, 'uid'>,
  productId: string,
  catalog: InventoryCatalogItem[],
  composition: ProductComposition
): Promise<ProductInventorySettings> => {
  const normalizedProductId = clean(productId);
  if (!validEntityId(normalizedProductId)) {
    throw new Error('O item da vitrine não foi identificado para a composição.');
  }

  const normalizedCatalog = parseInventoryCatalog(catalog);
  if (normalizedCatalog.length !== catalog.length) {
    throw new Error('Revise os componentes do estoque antes de salvar.');
  }

  const inventoryReference = doc(
    db,
    getProductInventoryDocumentPath(user.uid)
  );
  let nextSettings: ProductInventorySettings = {
    catalog: normalizedCatalog,
    compositions: {},
  };

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(inventoryReference);
    const current = readProductInventorySettings(snapshot.data());
    const nextComposition = {
      ...parseProductComposition(composition),
      updatedAt: new Date().toISOString(),
    };
    const compositions = { ...current.compositions };

    if (nextComposition.lines.length > 0) {
      compositions[normalizedProductId] = nextComposition;
    } else {
      delete compositions[normalizedProductId];
    }

    nextSettings = {
      catalog: normalizedCatalog,
      compositions: cleanCompositionsAgainstCatalog(
        compositions,
        normalizedCatalog
      ),
    };

    transaction.set(
      inventoryReference,
      {
        ownerId: user.uid,
        inventoryCatalog: nextSettings.catalog,
        productCompositions: nextSettings.compositions,
        updatedAt: serverTimestamp(),
        ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  });

  return nextSettings;
};
