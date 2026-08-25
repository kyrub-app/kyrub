import {
  calculateCompositionAvailableStock,
  parseInventoryCatalogRecords,
  parseInventoryCompositionRecords,
} from '../shared/inventoryConsumption.js';
import { adminDb } from '../server/firebaseAdmin.js';

type QueryValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  query?: Record<string, QueryValue>;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

const queryValue = (value: QueryValue): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

const cleanId = (value: string): string =>
  /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : '';

const cleanProductId = (value: unknown): string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.trim())
    ? value.trim()
    : '';

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  const storeId = cleanId(queryValue(request.query?.storeId));
  if (!storeId) {
    response.status(400).json({
      error: 'Loja inválida.',
      code: 'INVALID_STORE_ID',
    });
    return;
  }

  try {
    const tenantRef = adminDb.doc(`tenants/${storeId}`);
    const inventoryRef = adminDb.doc(`users/${storeId}/private_store/inventory`);
    const [tenantSnapshot, inventorySnapshot] = await Promise.all([
      tenantRef.get(),
      inventoryRef.get(),
    ]);

    if (!tenantSnapshot.exists) {
      response.status(404).json({
        error: 'Loja não encontrada.',
        code: 'STORE_NOT_FOUND',
      });
      return;
    }

    const tenantData = tenantSnapshot.data();
    const inventoryData = inventorySnapshot.data();
    const publicProducts = Array.isArray(tenantData?.publicProducts)
      ? tenantData.publicProducts
      : [];

    if (!inventorySnapshot.exists || publicProducts.length === 0) {
      response.status(200).json({ storeId, stockByProductId: {} });
      return;
    }

    const catalog = parseInventoryCatalogRecords(
      inventoryData?.inventoryCatalog ?? inventoryData?.catalog
    );
    const compositions = parseInventoryCompositionRecords(
      inventoryData?.compositions ?? inventoryData?.productCompositions
    );
    const stockByProductId: Record<string, number> = {};

    for (const candidate of publicProducts) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        continue;
      }
      const product = candidate as Record<string, unknown>;
      if (product.isService === true) continue;
      const productId = cleanProductId(product.id);
      if (!productId) continue;
      const available = calculateCompositionAvailableStock(
        catalog,
        compositions[productId]
      );
      if (available !== null) {
        stockByProductId[productId] = available;
      }
    }

    response.status(200).json({ storeId, stockByProductId });
  } catch (error) {
    console.error('[StorefrontAvailability] read failed.', error);
    response.status(503).json({
      error: 'Não foi possível consultar a disponibilidade da vitrine agora.',
      code: 'STOREFRONT_AVAILABILITY_UNAVAILABLE',
    });
  }
}
