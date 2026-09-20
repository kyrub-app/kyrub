import express from 'express';
import { createLocalAttendanceRouter } from './localAttendanceRouter.js';
import { createLocalStoreOwnedPixRouter } from './localStoreOwnedPixRouter.js';

type QueryValue = string | string[] | undefined;
type HeaderValue = string | string[] | undefined;

type RequestLike = {
  url?: string;
  method?: string;
  headers?: Record<string, HeaderValue>;
  query?: Record<string, QueryValue>;
  body?: unknown;
};

type ResponseLike = {
  once?: (event: string, listener: () => void) => unknown;
  writableEnded?: boolean;
  setHeader?: (name: string, value: string) => unknown;
  status?: (code: number) => ResponseLike;
  json?: (body: unknown) => unknown;
};

const app = express();
app.set('trust proxy', 1);
app.use('/api/local-attendance', createLocalAttendanceRouter());
app.use('/api/local-attendance', createLocalStoreOwnedPixRouter());

const first = (value: QueryValue | HeaderValue): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

const reconstructedQuery = (
  query: Record<string, QueryValue> | undefined
): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (key === 'transport' || key === 'path') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (typeof value === 'string') {
      params.append(key, value);
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
};

const handleAttendanceReviewTransport = async (
  request: RequestLike,
  response: ResponseLike,
  orderId: string
): Promise<void> => {
  if ((request.method?.toUpperCase() || 'GET') !== 'POST') {
    response.setHeader?.('Allow', 'POST');
    response.status?.(405).json?.({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  const execution = await import(
    '../inventory/attendanceReviewExecutionService.js'
  );
  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? { ...(request.body as Record<string, unknown>) }
    : {};
  body.orderId = orderId;
  const result = await execution.executeAuthorizedAttendanceReview(
    first(request.headers?.authorization ?? request.headers?.Authorization),
    body
  );
  response.status?.(result.status).json?.(result.body);
};

export const handleLocalAttendanceServerlessRequest = async (
  requestInput: unknown,
  responseInput: unknown
): Promise<void> => {
  const request = requestInput as RequestLike;
  const response = responseInput as ResponseLike;
  const path = first(request.query?.path).replace(/^\/+|\/+$/g, '');
  const attendanceReviewMatch = /^orders\/([^/]+)\/attendance-review$/.exec(path);
  if (attendanceReviewMatch) {
    await handleAttendanceReviewTransport(
      request,
      response,
      attendanceReviewMatch[1]
    );
    return;
  }

  const originalUrl = request.url;
  request.url = `/api/local-attendance${path ? `/${path}` : ''}${reconstructedQuery(request.query)}`;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve();
      };

      response.once?.('finish', () => settle());
      response.once?.('close', () => settle());

      app(
        requestInput as Parameters<typeof app>[0],
        responseInput as Parameters<typeof app>[1],
        (error?: unknown) =>
          settle(error ?? new Error('LOCAL_ATTENDANCE_ROUTE_NOT_FOUND'))
      );

      if (response.writableEnded) settle();
    });
  } finally {
    request.url = originalUrl;
  }
};
