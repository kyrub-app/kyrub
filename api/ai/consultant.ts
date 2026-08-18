import type {
  KyrubAiConsultantErrorResponse,
} from '../../shared/aiConsultant';
import { authenticateConsultantRequest } from '../../server/ai/consultantAuth';
import { runKyrubConsultant } from '../../server/ai/consultantService';
import { ConsultantHttpError } from '../../server/ai/types';
import { adminDb } from '../../server/firebaseAdmin';

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });

const errorResponse = (error: unknown): Response => {
  if (error instanceof ConsultantHttpError) {
    const payload: KyrubAiConsultantErrorResponse = {
      error: error.message,
      code: error.code,
    };
    return json(payload, error.status);
  }

  console.error('[Kyrub AI] Unhandled Vercel function failure.', error);
  const payload: KyrubAiConsultantErrorResponse = {
    error: 'O Consultor Kyrub está temporariamente indisponível.',
    code: 'AI_UNAVAILABLE',
  };
  return json(payload, 503);
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

const readInventory = async (uid: string): Promise<Response> => {
  const snapshot = await adminDb.doc(`users/${uid}/private_store/inventory`).get();
  const data = snapshot.data() as Record<string, unknown> | undefined;
  const rawCatalog = Array.isArray(data?.inventoryCatalog)
    ? data.inventoryCatalog
    : Array.isArray(data?.catalog)
      ? data.catalog
      : [];
  const items = (rawCatalog as unknown[])
    .flatMap(item => {
      const normalized = normalizeInventoryItem(item);
      return normalized ? [normalized] : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

  return json({
    available: true,
    generatedAt: new Date().toISOString(),
    items,
    itemCount: items.length,
  });
};

export const maxDuration = 30;

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const user = await authenticateConsultantRequest(
        request.headers.get('authorization')
      );

      if (request.method === 'GET') {
        const resource = new URL(request.url).searchParams.get('resource');
        if (resource === 'inventory') {
          return readInventory(user.uid);
        }
        const payload: KyrubAiConsultantErrorResponse = {
          error: 'Recurso de leitura não reconhecido.',
          code: 'METHOD_NOT_ALLOWED',
        };
        return json(payload, 405);
      }

      if (request.method !== 'POST') {
        const payload: KyrubAiConsultantErrorResponse = {
          error: 'Método não permitido.',
          code: 'METHOD_NOT_ALLOWED',
        };
        return json(payload, 405);
      }

      const body = await request.json().catch(() => ({}));
      return json(await runKyrubConsultant(body, user));
    } catch (error) {
      return errorResponse(error);
    }
  },
};