import legacyKyrubiaHandler from '../compat-api/kyrubiaLegacyRoute.js';
import {
  prepareKyrubiaMercadoLivrePlatformConversation,
  shouldRouteKyrubiaMercadoLivrePlatformContinuation,
} from '../server/ai/kyrubiaMercadoLivrePlatformConversation.js';

type HeaderValue = string | string[] | undefined;

type VercelRequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
};

type VercelResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponseLike;
  json(body: unknown): void;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const readBody = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const header = (value: HeaderValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const authorizationHeader = (request: VercelRequestLike): string =>
  header(request.headers.authorization ?? request.headers.Authorization);

const unwrapCurrentUserRequest = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const marker = '[current_user_request]';
  const index = value.lastIndexOf(marker);
  return (index >= 0 ? value.slice(index + marker.length) : value).trim();
};

const sanitizeLatestUserMessage = (
  body: Record<string, unknown>
): { body: Record<string, unknown>; latestMessage: string } => {
  if (!Array.isArray(body.messages)) return { body, latestMessage: '' };
  const messages = body.messages.map(item =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? { ...(item as Record<string, unknown>) }
      : item
  );
  let latestMessage = '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const message = item as Record<string, unknown>;
    if (message.role !== 'user') continue;
    latestMessage = unwrapCurrentUserRequest(message.content);
    messages[index] = { ...message, content: latestMessage };
    break;
  }
  return { body: { ...body, messages }, latestMessage };
};

const consultantError = (error: unknown): { status: number; body: unknown } => {
  const candidate = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  const status = typeof candidate.status === 'number' && Number.isInteger(candidate.status)
    ? candidate.status
    : 503;
  const code = typeof candidate.code === 'string' && candidate.code.trim()
    ? candidate.code.trim()
    : 'AI_UNAVAILABLE';
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'A Kyrubia não conseguiu continuar o fluxo do Mercado Livre agora.';
  return { status, body: { error: message, code } };
};

export const maxDuration = 30;

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike
): Promise<void> {
  if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
    await legacyKyrubiaHandler(request, response);
    return;
  }

  const rawBody = readBody(request.body);
  const sanitized = sanitizeLatestUserMessage(rawBody);
  const authorization = authorizationHeader(request);

  try {
    if (
      shouldRouteKyrubiaMercadoLivrePlatformContinuation({
        turnContext: sanitized.body.turnContext,
        selectedOfferedIntentId: sanitized.body.selectedOfferedIntentId,
        message: sanitized.latestMessage,
      })
    ) {
      const chat = await import('../server/ai/kyrubiaUserProviderChatService.js');
      const result = await chat.executeAuthorizedKyrubiaUserProviderChat(
        authorization,
        sanitized.body
      );
      if (result.body.status === 'deterministic') {
        response.status(result.httpStatus).json(result.body);
        return;
      }
    }

    const prepared = await prepareKyrubiaMercadoLivrePlatformConversation({
      authorization,
      conversationId: typeof sanitized.body.conversationId === 'string'
        ? sanitized.body.conversationId
        : '',
      message: sanitized.latestMessage,
      erpContext: sanitized.body.erpContext,
    });
    if (prepared) {
      response.status(200).json(prepared);
      return;
    }
  } catch (error) {
    const mapped = consultantError(error);
    response.status(mapped.status).json(mapped.body);
    return;
  }

  await legacyKyrubiaHandler(request, response);
}
