import { authenticateConsultantRequest } from '../server/ai/consultantAuth.js';
import { adminDb } from '../server/firebaseAdmin.js';

type HeaderValue = string | string[] | undefined;

type VercelRequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
};

type VercelResponseLike = {
  status(code: number): VercelResponseLike;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
};

const authorizationHeader = (request: VercelRequestLike): string => {
  const value = request.headers.authorization;
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
};

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;

const isInventoryUnit = (
  value: unknown
): value is 'un' | 'kg' | 'g' | 'l' | 'ml' =>
  value === 'un' || value === 'kg' || value === 'g' || value === 'l' || value === 'ml';

const normalizeInventoryItem = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = cleanText(candidate.id, 180);
  const name = cleanText(candidate.name, 180);
  const unit = candidate.unit;
  if (!id || !name || !isInventoryUnit(unit)) return null;

  return {
    id,
    name,
    unit,
    currentQuantity: finiteNonNegative(candidate.currentQuantity),
    minimumQuantity: finiteNonNegative(candidate.minimumQuantity),
    purchaseCost: finiteNonNegative(candidate.purchaseCost),
    supplier: cleanText(candidate.supplier, 160),
  };
};

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'GET') {
    response.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    const actor = await authenticateConsultantRequest(authorizationHeader(request));
    const snapshot = await adminDb.doc(`users/${actor.uid}/private_store/inventory`).get();
    const data = snapshot.data() as Record<string, unknown> | undefined;
    const rawCatalog = Array.isArray(data?.inventoryCatalog)
      ? data?.inventoryCatalog
      : Array.isArray(data?.catalog)
        ? data?.catalog
        : [];
    const items = (rawCatalog as unknown[])
      .flatMap(item => {
        const normalized = normalizeInventoryItem(item);
        return normalized ? [normalized] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

    response.status(200).json({
      available: true,
      generatedAt: new Date().toISOString(),
      items,
      itemCount: items.length,
    });
  } catch (error) {
    const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
    const status = typeof candidate.status === 'number' ? candidate.status : 500;
    response.status(status).json({
      code: typeof candidate.code === 'string' ? candidate.code : 'INVENTORY_READ_FAILED',
      error: typeof candidate.message === 'string'
        ? candidate.message
        : 'Não foi possível consultar o estoque privado agora.',
    });
  }
}
