import express from 'express';
import { createUserNotificationRouter } from './userNotificationRouter.js';
import { createUserCommunicationPreferenceRouter } from './userCommunicationPreferenceRouter.js';
import { createStoreCustomerChatRouter } from '../chat/storeCustomerChatRouter.js';

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
};

const app = express();
app.set('trust proxy', 1);
app.use('/api/notifications', createUserNotificationRouter());
app.use('/api/store-chat', createStoreCustomerChatRouter());
app.use('/api/communication-preferences', createUserCommunicationPreferenceRouter());

const first = (value: QueryValue | HeaderValue): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

const querySuffix = (query: Record<string, QueryValue> | undefined): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (key === 'transport' || key === 'path' || key === 'surface') continue;
    if (Array.isArray(value)) for (const item of value) params.append(key, item);
    else if (typeof value === 'string') params.append(key, value);
  }
  const encoded = params.toString();
  return encoded ? '?' + encoded : '';
};

export async function handleUserNotificationsServerlessRequest(
  requestInput: unknown,
  responseInput: unknown,
): Promise<void> {
  const request = requestInput as RequestLike;
  const response = responseInput as ResponseLike;
  const path = first(request.query?.path).replace(/^\/+|\/+$/g, '');
  const surface = first(request.query?.surface);
  const prefix = surface === 'store-chat'
    ? '/api/store-chat'
    : surface === 'preferences'
      ? '/api/communication-preferences'
      : '/api/notifications';
  const originalUrl = request.url;
  request.url = prefix + (path ? '/' + path : '') + querySuffix(request.query);
  response.setHeader?.('Cache-Control', 'no-store, max-age=0');
  try {
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const settle = (error?: unknown) => {
        if (finished) return;
        finished = true;
        error ? reject(error) : resolve();
      };
      response.once?.('finish', () => settle());
      response.once?.('close', () => settle());
      app(
        requestInput as Parameters<typeof app>[0],
        responseInput as Parameters<typeof app>[1],
        (error?: unknown) => settle(error ?? new Error('USER_NOTIFICATIONS_ROUTE_NOT_FOUND')),
      );
      if (response.writableEnded) settle();
    });
  } finally {
    request.url = originalUrl;
  }
}
