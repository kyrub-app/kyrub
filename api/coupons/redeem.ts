import {
  mapStoreEntitlementError,
  redeemCouponForOwnStore,
} from '../../server/admin/storeEntitlementService.js';

type HeaderValue = string | string[] | undefined;
type RequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
};
type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

const header = (value: HeaderValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
    response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }
  try {
    const authorization = header(
      request.headers.authorization ?? request.headers.Authorization
    );
    const body = record(request.body);
    const result = await redeemCouponForOwnStore(authorization, body.code);
    response.status(200).json(result);
  } catch (error) {
    const mapped = mapStoreEntitlementError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
