import { executeGlobalChallengeAdmin, mapGlobalChallengeAdminError } from './globalChallengeAdminService.js';

type RequestLike = { method?: string; headers: Record<string, string | string[] | undefined>; query?: Record<string, unknown>; body?: unknown };
type ResponseLike = { setHeader(name: string, value: string): unknown; status(code: number): ResponseLike; json(body: unknown): unknown };

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  response.setHeader('cache-control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    response.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    return;
  }
  const authorization = request.headers.authorization;
  try {
    const operation = request.query?.operation ?? 'create';
    const challenge = await executeGlobalChallengeAdmin(typeof authorization === 'string' ? authorization : '',
      typeof operation === 'string' ? operation : '', request.body);
    response.status(operation === 'create' ? 201 : 200).json({ challenge });
  } catch (error) {
    const mapped = mapGlobalChallengeAdminError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
