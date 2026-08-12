import {
  loadPlanManagementSnapshot,
  mapPlanManagementError,
  publishPlanVersion,
} from '../../../server/admin/planManagementService.js';

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
  const method = (request.method ?? 'GET').toUpperCase();
  const authorization = header(
    request.headers.authorization ?? request.headers.Authorization
  );

  try {
    if (method === 'GET') {
      const snapshot = await loadPlanManagementSnapshot(authorization);
      response.status(200).json(snapshot);
      return;
    }
    if (method === 'POST') {
      const result = await publishPlanVersion(authorization, request.body);
      response.status(201).json(result);
      return;
    }
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
  } catch (error) {
    const mapped = mapPlanManagementError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
