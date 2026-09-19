import express from 'express';
import { createLocalAttendanceRouter } from './localAttendanceRouter.js';

type QueryValue = string | string[] | undefined;

type RequestLike = {
  url?: string;
  query?: Record<string, QueryValue>;
};

type ResponseLike = {
  once?: (event: string, listener: () => void) => unknown;
  writableEnded?: boolean;
};

const app = express();
app.set('trust proxy', 1);
app.use('/api/local-attendance', createLocalAttendanceRouter());

const first = (value: QueryValue): string =>
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

export const handleLocalAttendanceServerlessRequest = async (
  requestInput: unknown,
  responseInput: unknown
): Promise<void> => {
  const request = requestInput as RequestLike;
  const response = responseInput as ResponseLike;
  const path = first(request.query?.path).replace(/^\/+|\/+$/g, '');
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
