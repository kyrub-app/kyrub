import {
  grantComplimentaryPlanByAdmin,
  mapStoreEntitlementError,
} from '../../../server/admin/storeEntitlementService.js';

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
    const result = await grantComplimentaryPlanByAdmin(authorization, request.body);
    response.status(201).json(result);
  } catch (error) {
    const mapped = mapStoreEntitlementError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
