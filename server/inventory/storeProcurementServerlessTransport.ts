import express from 'express';
import { createStoreProcurementRouter } from './storeProcurementRouter.js';

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
app.use('/api/store-procurement', createStoreProcurementRouter());

const reconstructedQuery = (query: Record<string, QueryValue> | undefined): string => {
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

export const handleStoreProcurementServerlessRequest = async (
  requestInput: unknown,
  responseInput: unknown
): Promise<void> => {
  const request = requestInput as RequestLike;
  const response = responseInput as ResponseLike;
  const originalUrl = request.url;
  request.url = `/api/store-procurement${reconstructedQuery(request.query)}`;
  response.setHeader?.('Cache-Control', 'no-store, max-age=0');
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
        (error?: unknown) => settle(error ?? new Error('STORE_PROCUREMENT_ROUTE_NOT_FOUND'))
      );
      if (response.writableEnded) settle();
    });
  } finally {
    request.url = originalUrl;
  }
};
