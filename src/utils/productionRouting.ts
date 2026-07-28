import type { User } from 'firebase/auth';
import {
  doc,
  runTransaction,
  type DocumentData,
} from 'firebase/firestore';
import type { CustomerOrderItem } from './customerOrders';
import { db } from './firebase';

export const PRODUCTION_ROUTING_CACHE_KEY =
  'kyrub_product_preparation_stations';
export const PRODUCTION_ROUTING_UPDATED_EVENT =
  'kyrub-production-routing-updated';
export const PRODUCTION_SPACES_STORAGE_KEY = 'kyrub_producao_spaces';
export const DEFAULT_PRODUCTION_STATION = 'GERAL';

export type ProductPreparationStations = Record<string, string>;

export interface ProductionTicket {
  station: string;
  items: CustomerOrderItem[];
  quantity: number;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const normalizeProductionStation = (value: unknown): string => {
  const normalized = clean(value)
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('pt-BR');
  return normalized || DEFAULT_PRODUCTION_STATION;
};

export const readAvailableProductionStations = (): string[] => {
  if (typeof localStorage === 'undefined') {
    return [DEFAULT_PRODUCTION_STATION];
  }
  try {
    const parsed = JSON.parse(
      localStorage.getItem(PRODUCTION_SPACES_STORAGE_KEY) ?? '[]'
    ) as unknown;
    const values = Array.isArray(parsed) ? parsed : [];
    return [...new Set(
      [DEFAULT_PRODUCTION_STATION, ...values]
        .map(normalizeProductionStation)
        .filter(value => value !== 'TODOS')
    )];
  } catch {
    return [DEFAULT_PRODUCTION_STATION];
  }
};

export const parseProductPreparationStations = (
  value: unknown
): ProductPreparationStations => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: ProductPreparationStations = {};
  for (const [productId, station] of Object.entries(
    value as Record<string, unknown>
  )) {
    const id = clean(productId);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) continue;
    const normalized = normalizeProductionStation(station);
    if (normalized === DEFAULT_PRODUCTION_STATION && !clean(station)) continue;
    parsed[id] = normalized;
  }
  return parsed;
};

export const loadCachedProductPreparationStations = (): ProductPreparationStations => {
  if (typeof localStorage === 'undefined') return {};
  try {
    return parseProductPreparationStations(
      JSON.parse(localStorage.getItem(PRODUCTION_ROUTING_CACHE_KEY) ?? '{}')
    );
  } catch {
    return {};
  }
};

export const cacheProductPreparationStations = (
  stations: ProductPreparationStations
): void => {
  if (typeof localStorage === 'undefined' || typeof window === 'undefined') return;
  localStorage.setItem(
    PRODUCTION_ROUTING_CACHE_KEY,
    JSON.stringify(parseProductPreparationStations(stations))
  );
  window.dispatchEvent(
    new CustomEvent(PRODUCTION_ROUTING_UPDATED_EVENT, {
      detail: parseProductPreparationStations(stations),
    })
  );
};

export const readProductPreparationStationsFromTenant = (
  tenant: DocumentData | undefined
): ProductPreparationStations => {
  const operationalSettings =
    tenant?.operationalSettings && typeof tenant.operationalSettings === 'object'
      ? tenant.operationalSettings as Record<string, unknown>
      : {};
  return parseProductPreparationStations(
    operationalSettings.productPreparationStations
  );
};

export const resolveProductPreparationStation = (
  productId: string,
  stations: ProductPreparationStations
): string =>
  normalizeProductionStation(stations[productId] ?? DEFAULT_PRODUCTION_STATION);

export const buildProductionTickets = (
  items: CustomerOrderItem[],
  stations: ProductPreparationStations
): ProductionTicket[] => {
  const groups = new Map<string, CustomerOrderItem[]>();
  for (const item of items) {
    const station = resolveProductPreparationStation(item.productId, stations);
    groups.set(station, [...(groups.get(station) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([station, stationItems]) => ({
      station,
      items: stationItems,
      quantity: stationItems.reduce(
        (sum, item) => sum + Math.max(0, item.quantity - item.transferredQuantity),
        0
      ),
    }))
    .sort((left, right) => left.station.localeCompare(right.station, 'pt-BR'));
};

export const getProductionStationOptions = (
  items: CustomerOrderItem[],
  stations: ProductPreparationStations
): string[] =>
  [...new Set(
    items.map(item => resolveProductPreparationStation(item.productId, stations))
  )].sort((left, right) => left.localeCompare(right, 'pt-BR'));

const writeProductPreparationStations = async (
  user: Pick<User, 'uid'>,
  transform: (current: ProductPreparationStations) => ProductPreparationStations
): Promise<ProductPreparationStations> => {
  const tenantReference = doc(db, 'tenants', user.uid);
  let nextStations: ProductPreparationStations = {};
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(tenantReference);
    const data = snapshot.data();
    const current = readProductPreparationStationsFromTenant(data);
    nextStations = parseProductPreparationStations(transform(current));
    const operationalSettings =
      data?.operationalSettings && typeof data.operationalSettings === 'object'
        ? data.operationalSettings as Record<string, unknown>
        : {};
    transaction.set(
      tenantReference,
      {
        operationalSettings: {
          ...operationalSettings,
          productPreparationStations: nextStations,
        },
      },
      { merge: true }
    );
  });
  cacheProductPreparationStations(nextStations);
  return nextStations;
};

export const persistProductPreparationStation = async (
  user: Pick<User, 'uid'>,
  productId: string,
  station: string
): Promise<ProductPreparationStations> => {
  const normalizedProductId = clean(productId);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(normalizedProductId)) {
    throw new Error('O produto não foi identificado para roteamento.');
  }
  const normalizedStation = normalizeProductionStation(station);
  if (normalizedStation.length > 80) {
    throw new Error('O nome do setor deve ter no máximo 80 caracteres.');
  }
  return writeProductPreparationStations(user, current => ({
    ...current,
    [normalizedProductId]: normalizedStation,
  }));
};

export const removeProductPreparationStation = async (
  user: Pick<User, 'uid'>,
  productId: string
): Promise<ProductPreparationStations> => {
  const normalizedProductId = clean(productId);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(normalizedProductId)) {
    throw new Error('O produto não foi identificado para roteamento.');
  }
  return writeProductPreparationStations(user, current => {
    const next = { ...current };
    delete next[normalizedProductId];
    return next;
  });
};
