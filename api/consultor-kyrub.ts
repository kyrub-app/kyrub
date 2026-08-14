import type { KyrubAiConversationMessage } from '../shared/aiConsultant.js';
import { shouldUseKyrubiaCatalogAnalysis } from '../shared/kyrubiaCatalogAnalysisIntent.js';
import { handleKyrubiaCatalogAnalysis } from '../server/kyrubiaCatalogAnalysisRoute.js';
import handleKyrubia from './kyrubia.js';

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

/**
 * Compatibility description for the historical /api/consultor-kyrub route.
 * The actual create_note behavior lives in the canonical Kyrubia route; this
 * descriptor keeps the public capability contract visible without duplicating
 * provider or write logic here.
 */
const CONSULTOR_KYRUB_COMPATIBILITY = {
  service: 'consultor-kyrub',
  functionDeclarations: [
    { name: 'create_note' },
  ],
} as const;

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
  response.setHeader('cache-control', 'no-store');

  if (request.method === 'GET') {
    response.status(200).json({
      status: 'ok',
      service: CONSULTOR_KYRUB_COMPATIBILITY.service,
      persona: 'Kyrubia',
      actionsEnabled: true,
      enabledActions: CONSULTOR_KYRUB_COMPATIBILITY.functionDeclarations.map(
        declaration => declaration.name
      ),
      catalogAnalysisEnabled: true,
      routerEnabled: true,
    });
    return;
  }

  if (request.method === 'POST') {
    const messages = conversationMessages(readBody(request.body));
    if (shouldUseKyrubiaCatalogAnalysis(messages)) {
      await handleKyrubiaCatalogAnalysis(request, response);
      return;
    }
  }

  await handleKyrubia(request, response);
}
