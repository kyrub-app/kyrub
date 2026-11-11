import express, { type ErrorRequestHandler } from 'express';
import { consumeGlobalChallengeIngress, GlobalChallengeRateLimitError } from './globalChallengeAdminRateLimit.js';
import { executeGlobalChallengeAdmin, mapGlobalChallengeAdminError } from './globalChallengeAdminService.js';

type RequestLike = { method?: string; headers: Record<string, string | string[] | undefined>; query?: Record<string, unknown>; body?: unknown; rawBody?: Buffer };
type ResponseLike = { setHeader(name: string, value: string): unknown; status(code: number): ResponseLike; json(body: unknown): unknown };

export const GLOBAL_CHALLENGE_PAYLOAD_BYTES = 32 * 1024;
// Express admits before parsing; the direct Vercel adapter admits in handler.
// A private WeakSet prevents double-counting without trusting headers/body.
const admittedRequests = new WeakSet<object>();
const admitIngress = async (request: object) => {
  if (admittedRequests.has(request)) return;
  await consumeGlobalChallengeIngress();
  admittedRequests.add(request);
};

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  response.setHeader('cache-control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    response.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    return;
  }
  const authorization = request.headers.authorization;
  try {
    await admitIngress(request);
    const mediaType = request.headers['content-type'];
    if (typeof mediaType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(mediaType)) {
      response.status(415).json({ code: 'JSON_REQUIRED' }); return;
    }
    const length = request.headers['content-length'];
    const rawLength = Buffer.isBuffer(request.rawBody) ? request.rawBody.byteLength :
      typeof length === 'string' && /^\d+$/.test(length) ? Number(length) : null;
    if (rawLength === null || !Number.isSafeInteger(rawLength)) {
      response.status(411).json({ code: 'CONTENT_LENGTH_REQUIRED' }); return;
    }
    if (rawLength > GLOBAL_CHALLENGE_PAYLOAD_BYTES ||
        Buffer.byteLength(JSON.stringify(request.body) ?? '', 'utf8') > GLOBAL_CHALLENGE_PAYLOAD_BYTES) {
      response.status(413).json({ code: 'PAYLOAD_TOO_LARGE' }); return;
    }
    const operation = request.query?.operation ?? 'create';
    const challenge = await executeGlobalChallengeAdmin(typeof authorization === 'string' ? authorization : '',
      typeof operation === 'string' ? operation : '', request.body);
    response.status(operation === 'create' ? 201 : 200).json({ challenge });
  } catch (error) {
    if (error instanceof GlobalChallengeRateLimitError) {
      response.setHeader('retry-after', String(error.retryAfter));
      response.status(429).json({ code: 'GLOBAL_CHALLENGE_RATE_LIMITED' }); return;
    }
    const mapped = mapGlobalChallengeAdminError(error);
    response.status(mapped.status).json(mapped.body);
  }
}

// Mount before the application's general parser so wire bytes (including
// whitespace and chunked bodies) are bounded before parsing on Express.
export const createGlobalChallengeAdminRouter = () => {
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader('cache-control', 'no-store'); next(); });
  router.use((req, _res, next) => { void admitIngress(req).then(() => next(), next); });
  router.use(express.json({ limit: GLOBAL_CHALLENGE_PAYLOAD_BYTES, strict: false,
    inflate: false, verify: (req, _res, bytes) => { (req as RequestLike).rawBody = bytes; } }));
  router.all('/', (req, res) => { void handler(req, res); });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof GlobalChallengeRateLimitError) {
      res.setHeader('retry-after', String(error.retryAfter));
      res.status(429).json({ code: 'GLOBAL_CHALLENGE_RATE_LIMITED' }); return;
    }
    const status = error?.status === 413 ? 413 : error?.status === 415 ? 415 : 400;
    res.status(status).json({ code: status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 415 ? 'JSON_REQUIRED' : 'CHALLENGE_INPUT_INVALID' });
  };
  router.use(errors);
  return router;
};
