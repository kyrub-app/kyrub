import type { Product } from '../types';

export const getProductRecency = (product: Product): number => {
  const updatedAt = (product as Product & { updatedAt?: string }).updatedAt?.trim() ?? '';
  const parsedUpdatedAt = Date.parse(updatedAt);
  if (Number.isFinite(parsedUpdatedAt)) return parsedUpdatedAt;
  const idTimestamp = product.id.match(/(\d{10,})$/)?.[1];
  const parsedIdTimestamp = idTimestamp ? Number(idTimestamp) : 0;
  return Number.isFinite(parsedIdTimestamp) ? parsedIdTimestamp : 0;
};

export const sortByNewest = (offers: Product[]): Product[] =>
  [...offers].sort((left, right) => {
    const recencyDifference = getProductRecency(right) - getProductRecency(left);
    return recencyDifference || right.id.localeCompare(left.id);
  });

export const sortByBestSellers = (
  offers: Product[],
  salesByProductId: Record<string, number>
): Product[] =>
  sortByNewest(offers).sort((left, right) => {
    const salesDifference =
      (salesByProductId[right.id] ?? 0) -
      (salesByProductId[left.id] ?? 0);
    return salesDifference || getProductRecency(right) - getProductRecency(left);
  });
