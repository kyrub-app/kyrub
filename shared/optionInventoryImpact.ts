import {
  applyInventoryConsumptionLines,
  buildOrderInventoryConsumption,
  type InventoryCatalogRecord,
  type InventoryCompositionRecord,
  type InventoryConsumptionLine,
  type InventoryOrderItemRecord,
} from './inventoryConsumption';

export interface InventorySelectedOptionRef {
  groupId: string;
  choiceId: string;
}

export interface OptionInventoryImpactLine {
  inventoryItemId: string;
  quantity: number;
}

export interface OptionInventoryImpactRecord {
  scopeType: 'catalog_path' | 'product';
  scopeId: string;
  groupId: string;
  choiceId: string;
  lines: OptionInventoryImpactLine[];
}

export interface OptionAwareInventoryOrderItem extends InventoryOrderItemRecord {
  selectedOptions?: InventorySelectedOptionRef[];
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

const splitPath = (value: string): string[] =>
  value
    .split(/\s*(?:>|\/)\s*/)
    .map(segment => segment.trim())
    .filter(Boolean);

const normalizePath = (value: string): string =>
  splitPath(value).map(normalize).join(' > ');

const validId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,128}$/.test(value);

const positive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

export const parseInventorySelectedOptions = (
  value: unknown
): InventorySelectedOptionRef[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 30).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const record = candidate as Record<string, unknown>;
    const groupId = clean(record.groupId);
    const choiceId = clean(record.choiceId);
    const key = `${groupId}:${choiceId}`;
    if (!validId(groupId) || !validId(choiceId) || seen.has(key)) return [];
    seen.add(key);
    return [{ groupId, choiceId }];
  });
};

export const parseOptionInventoryImpacts = (
  value: unknown
): OptionInventoryImpactRecord[] => {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, OptionInventoryImpactRecord>();

  for (const candidate of value.slice(0, 500)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const scopeType = record.scopeType === 'product' ? 'product' : 'catalog_path';
    const rawScopeId = clean(record.scopeId);
    const scopeId = scopeType === 'catalog_path'
      ? splitPath(rawScopeId).slice(0, 3).join(' > ')
      : rawScopeId;
    const groupId = clean(record.groupId);
    const choiceId = clean(record.choiceId);
    if (
      !scopeId ||
      !validId(groupId) ||
      !validId(choiceId) ||
      (scopeType === 'product' && !validId(scopeId)) ||
      (scopeType === 'catalog_path' && splitPath(scopeId).length < 2)
    ) {
      continue;
    }

    const lines = Array.isArray(record.lines)
      ? [...new Map(
          record.lines.slice(0, 20).flatMap(candidateLine => {
            if (
              !candidateLine ||
              typeof candidateLine !== 'object' ||
              Array.isArray(candidateLine)
            ) {
              return [];
            }
            const line = candidateLine as Record<string, unknown>;
            const inventoryItemId = clean(line.inventoryItemId);
            const quantity = positive(line.quantity);
            if (!validId(inventoryItemId) || quantity === null) return [];
            return [[inventoryItemId, { inventoryItemId, quantity }] as const];
          })
        ).values()]
      : [];
    if (lines.length === 0) continue;

    const key = `${scopeType}:${normalizePath(scopeId)}:${groupId}:${choiceId}`;
    byKey.set(key, { scopeType, scopeId, groupId, choiceId, lines });
  }

  return [...byKey.values()];
};

const isPathAncestor = (candidate: string, category: string): boolean => {
  const candidateSegments = splitPath(candidate).map(normalize);
  const categorySegments = splitPath(category).map(normalize);
  return (
    candidateSegments.length >= 2 &&
    candidateSegments.length <= categorySegments.length &&
    candidateSegments.every(
      (segment, index) => categorySegments[index] === segment
    )
  );
};

const resolveImpact = (
  productId: string,
  category: string,
  selected: InventorySelectedOptionRef,
  impacts: OptionInventoryImpactRecord[]
): OptionInventoryImpactRecord | null => {
  const matching = impacts.filter(impact =>
    impact.groupId === selected.groupId &&
    impact.choiceId === selected.choiceId &&
    (
      (impact.scopeType === 'product' && impact.scopeId === productId) ||
      (impact.scopeType === 'catalog_path' && isPathAncestor(impact.scopeId, category))
    )
  );

  return matching.sort((left, right) => {
    const leftRank = left.scopeType === 'product'
      ? 100
      : splitPath(left.scopeId).length;
    const rightRank = right.scopeType === 'product'
      ? 100
      : splitPath(right.scopeId).length;
    return rightRank - leftRank;
  })[0] ?? null;
};

const buildOptionConsumption = (
  orderItems: OptionAwareInventoryOrderItem[],
  catalog: InventoryCatalogRecord[],
  productCategories: Record<string, string>,
  impacts: OptionInventoryImpactRecord[]
): InventoryConsumptionLine[] => {
  const parsedImpacts = parseOptionInventoryImpacts(impacts);
  const catalogById = new Map(catalog.map(item => [item.id, item]));
  const totals = new Map<
    string,
    { quantity: number; productIds: Set<string> }
  >();

  for (const item of orderItems) {
    const operationalQuantity = Math.max(
      0,
      Math.trunc(item.quantity) - Math.trunc(item.transferredQuantity ?? 0)
    );
    if (operationalQuantity <= 0) continue;
    const category = clean(productCategories[item.productId]);

    for (const selected of item.selectedOptions ?? []) {
      const impact = resolveImpact(item.productId, category, selected, parsedImpacts);
      if (!impact) continue;
      for (const line of impact.lines) {
        const current = totals.get(line.inventoryItemId) ?? {
          quantity: 0,
          productIds: new Set<string>(),
        };
        current.quantity += line.quantity * operationalQuantity;
        current.productIds.add(item.productId);
        totals.set(line.inventoryItemId, current);
      }
    }
  }

  return [...totals.entries()].map(([inventoryItemId, total]) => {
    const inventoryItem = catalogById.get(inventoryItemId);
    if (!inventoryItem) {
      throw new Error(
        `A personalização referencia um componente removido (${inventoryItemId}).`
      );
    }
    const quantity = Math.round(total.quantity * 1_000_000) / 1_000_000;
    if (inventoryItem.currentQuantity + 0.000001 < quantity) {
      throw new Error(
        `Estoque insuficiente de “${inventoryItem.name}” para a personalização: necessário ${quantity} ${inventoryItem.unit}, disponível ${inventoryItem.currentQuantity} ${inventoryItem.unit}.`
      );
    }
    return {
      inventoryItemId,
      inventoryItemName: inventoryItem.name,
      unit: inventoryItem.unit,
      quantity,
      beforeQuantity: inventoryItem.currentQuantity,
      afterQuantity:
        Math.round((inventoryItem.currentQuantity - quantity) * 1_000_000) /
        1_000_000,
      productIds: [...total.productIds].sort(),
    } satisfies InventoryConsumptionLine;
  });
};

const mergeConsumptionLines = (
  base: InventoryConsumptionLine[],
  extras: InventoryConsumptionLine[]
): InventoryConsumptionLine[] => {
  const byItem = new Map<string, InventoryConsumptionLine>();
  for (const line of base) byItem.set(line.inventoryItemId, { ...line });
  for (const extra of extras) {
    const current = byItem.get(extra.inventoryItemId);
    if (!current) {
      byItem.set(extra.inventoryItemId, extra);
      continue;
    }
    byItem.set(extra.inventoryItemId, {
      ...current,
      quantity:
        Math.round((current.quantity + extra.quantity) * 1_000_000) / 1_000_000,
      afterQuantity: extra.afterQuantity,
      productIds: [...new Set([...current.productIds, ...extra.productIds])].sort(),
    });
  }
  return [...byItem.values()].sort((left, right) =>
    left.inventoryItemName.localeCompare(right.inventoryItemName, 'pt-BR')
  );
};

export const buildOrderInventoryConsumptionWithOptions = (
  orderItems: OptionAwareInventoryOrderItem[],
  catalog: InventoryCatalogRecord[],
  compositions: Record<string, InventoryCompositionRecord>,
  productCategories: Record<string, string>,
  impacts: OptionInventoryImpactRecord[]
): InventoryConsumptionLine[] => {
  const base = buildOrderInventoryConsumption(orderItems, catalog, compositions);
  const afterBase = applyInventoryConsumptionLines(catalog, base, 'consume');
  const extras = buildOptionConsumption(
    orderItems,
    afterBase,
    productCategories,
    impacts
  );
  return mergeConsumptionLines(base, extras);
};
