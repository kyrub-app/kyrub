import type { KyrubAiConversationMessage } from '../shared/aiConsultant.js';
import { shouldUseKyrubiaCatalogAnalysis } from '../shared/kyrubiaCatalogAnalysisIntent.js';
import handleKyrubia from './kyrubia.js';
import handleCatalogAnalysis from './kyrubia-catalog-analysis.js';

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

const readBody = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const conversationMessages = (body: Record<string, unknown>): KyrubAiConversationMessage[] =>
  Array.isArray(body.messages)
    ? body.messages.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const candidate = item as Record<string, unknown>;
        if (candidate.role !== 'user' && candidate.role !== 'assistant') return [];
        if (typeof candidate.content !== 'string') return [];
        return [{
          role: candidate.role,
          content: candidate.content,
          attachments: Array.isArray(candidate.attachments)
            ? candidate.attachments as KyrubAiConversationMessage['attachments']
            : undefined,
        }];
      })
    : [];

export const maxDuration = 30;

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike
): Promise<void> {
  if (request.method !== 'POST') {
    await handleKyrubia(request, response);
    return;
  }

  const body = readBody(request.body);
  const messages = conversationMessages(body);
  if (shouldUseKyrubiaCatalogAnalysis(messages)) {
    await handleCatalogAnalysis(request, response);
    return;
  }

  await handleKyrubia(request, response);
}
