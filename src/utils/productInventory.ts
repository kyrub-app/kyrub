import type { User } from 'firebase/auth';
import {
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import { planProductCompositionEdit } from './productCompositionMutation';

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
export type InventoryCostBasisStatus = 'complete' | 'incomplete';
export type InventoryCostBasisSource =
  | 'legacy_purchase_cost_seed'
  | 'purchase_receipt'
  | 'inventory_outflow'
  | 'inventory_restoration'
  | 'manual_adjustment'
  | 'unknown';

export interface InventoryCatalogItem {
  id: string;
  name: string;
  unit: InventoryUnit;
  currentQuantity: number;
  minimumQuantity: number;
  purchaseCost: number;
  supplier: string;
  updatedAt: string;
  costBasisStatus?: InventoryCostBasisStatus;
  averageUnitCostMinor?: number | null;
  lastPurchaseUnitCostMinor?: number | null;
  inventoryValueMinor?: number | null;
  costBasisSource?: InventoryCostBasisSource;
  costBasisUpdatedAt?: string;
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

const finiteNonNegativeInteger = (value: unknown): number | null => {
  const numeric = finiteNonNegative(value);
  return numeric !== null && Number.isSafeInteger(numeric) ? numeric : null;
};

const positiveNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

const validEntityId = (value: string): boolean =>
  /^[a-zA-Z0-9_-]{1,128}$/.test(value);

const parseCostBasisSource = (value: unknown): InventoryCostBasisSource | undefined => {
  switch (value) {
    case 'legacy_purchase_cost_seed':
    case 'purchase_receipt':
    case 'inventory_outflow':
    case 'inventory_restoration':
    case 'manual_adjustment':
    case 'unknown':
      return value;
    default:
      return undefined;
  }
};

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
    const costBasisStatus = item.costBasisStatus === 'complete' || item.costBasisStatus === 'incomplete'
      ? item.costBasisStatus
      : undefined;
    const averageUnitCostMinor = finiteNonNegative(item.averageUnitCostMinor);
    const lastPurchaseUnitCostMinor = finiteNonNegativeInteger(item.lastPurchaseUnitCostMinor);
    const inventoryValueMinor = finiteNonNegativeInteger(item.inventoryValueMinor);
    const costBasisSource = parseCostBasisSource(item.costBasisSource);
    const costBasisUpdatedAt = clean(item.costBasisUpdatedAt);

    return [{
      id,
      name,
      unit: item.unit,
      currentQuantity,
      minimumQuantity,
      purchaseCost,
      supplier: clean(item.supplier).slice(0, 160),
      updatedAt: clean(item.updatedAt),
      ...(costBasisStatus ? { costBasisStatus } : {}),
      ...(averageUnitCostMinor !== null ? { averageUnitCostMinor } : {}),
      ...(lastPurchaseUnitCostMinor !== null ? { lastPurchaseUnitCostMinor } : {}),
      ...(inventoryValueMinor !== null ? { inventoryValueMinor } : {}),
      ...(costBasisSource ? { costBasisSource } : {}),
      ...(costBasisUpdatedAt ? { costBasisUpdatedAt } : {}),
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
  catalog: parseInventoryCatalog(
    Array.isArray(value?.inventoryCatalog)
      ? value.inventoryCatalog
      : value?.catalog
  ),
  compositions: parseProductCompositions(
    value?.productCompositions && typeof value.productCompositions === 'object'
      ? value.productCompositions
      : value?.compositions
  ),
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

const comparableInventorySettings = (settings: ProductInventorySettings) => ({
  catalog: settings.catalog.map(({ updatedAt: _updatedAt, ...item }) => item),
  compositions: Object.fromEntries(
    Object.entries(settings.compositions)
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
      .map(([productId, { updatedAt: _updatedAt, ...composition }]) => [
        productId,
        composition,
      ])
  ),
});

export const productInventorySettingsEquivalent = (
  left: ProductInventorySettings,
  right: ProductInventorySettings
): boolean =>
  JSON.stringify(comparableInventorySettings(left)) ===
  JSON.stringify(comparableInventorySettings(right));

export const persistProductInventorySettings = async (
  user: Pick<User, 'uid'>,
  productId: string,
  catalog: InventoryCatalogItem[],
  composition: ProductComposition,
  baseline: { catalog: InventoryCatalogItem[]; composition: ProductComposition }
): Promise<ProductInventorySettings & { changed: boolean }> => {
  const normalizedProductId = clean(productId);
  if (!validEntityId(normalizedProductId)) {
    throw new Error('O item da vitrine não foi identificado para a composição.');
  }

  // Catalog management is owned by the global inventory workspace, not a product draft.
  const normalizedCatalog = parseInventoryCatalog(catalog);
  if (normalizedCatalog.length !== catalog.length ||
    JSON.stringify(normalizedCatalog) !== JSON.stringify(parseInventoryCatalog(baseline.catalog))) {
    throw new Error('Altere os itens e saldos na guia Estoque da loja antes de salvar a composição.');
  }
  const proposed = parseProductComposition(composition);
  if (proposed.lines.length !== composition.lines.length) {
    throw new Error('Revise os componentes da composição antes de salvar.');
  }

  const reference = doc(db, getProductInventoryDocumentPath(user.uid));
  const updatedAt = new Date().toISOString();
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const current = readProductInventorySettings(snapshot.data());
    const { settings, changed } = planProductCompositionEdit(
      current, normalizedProductId, parseProductComposition(baseline.composition), proposed, updatedAt
    );
    if (changed) {
      const data = {
        ownerId: user.uid,
        productCompositions: settings.compositions,
        compositions: settings.compositions,
        updatedAt: serverTimestamp(),
        ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
      };
      transaction.set(reference, data, { mergeFields: Object.keys(data) });
    }
    return { ...settings, changed };
  });
};
