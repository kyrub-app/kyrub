import { randomUUID } from 'node:crypto';
import {
  KYRUB_AI_LIMITS,
  type KyrubAiConsultantRequest,
  type KyrubAiConsultantResponse,
  type KyrubAiConversationMessage,
} from '../../shared/aiConsultant';
import { buildKyrubConsultantSystemInstruction } from './consultantPrompt';
import { createGeminiConsultantProvider } from './geminiConsultantProvider';
import type {
  AiConsultantProvider,
  AuthenticatedConsultantUser,
} from './types';
import { ConsultantHttpError } from './types';

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const validateMessages = (value: unknown): KyrubAiConversationMessage[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConsultantHttpError(
      400,
      'INVALID_REQUEST',
      'Envie pelo menos uma mensagem para o Consultor Kyrub.'
    );
  }

  const messages = value
    .slice(-KYRUB_AI_LIMITS.maxMessagesPerRequest)
    .map(item => {
      const candidate = item && typeof item === 'object'
        ? item as Record<string, unknown>
        : {};
      const role = candidate.role === 'assistant' ? 'assistant' : 'user';
      const content = cleanText(
        candidate.content,
        KYRUB_AI_LIMITS.maxMessageCharacters
      );
      return { role, content } satisfies KyrubAiConversationMessage;
    })
    .filter(message => message.content.length > 0);

  if (messages.length === 0 || messages[messages.length - 1]?.role !== 'user') {
    throw new ConsultantHttpError(
      400,
      'INVALID_REQUEST',
      'A solicitação precisa terminar com uma mensagem do usuário.'
    );
  }

  const totalCharacters = messages.reduce(
    (total, message) => total + message.content.length,
    0
  );
  if (totalCharacters > KYRUB_AI_LIMITS.maxTotalCharacters) {
    throw new ConsultantHttpError(
      400,
      'INVALID_REQUEST',
      'A conversa ficou muito longa para esta solicitação. Inicie um novo assunto.'
    );
  }

  return messages;
};

export const normalizeConsultantRequest = (
  value: unknown
): KyrubAiConsultantRequest => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const conversationId = cleanText(candidate.conversationId, 120);
  const topic = cleanText(
    candidate.topic,
    KYRUB_AI_LIMITS.maxTopicCharacters
  ) || 'Nova solicitação';
  const screenContext = cleanText(
    candidate.screenContext,
    KYRUB_AI_LIMITS.maxScreenContextCharacters
  );

  if (!conversationId) {
    throw new ConsultantHttpError(
      400,
      'INVALID_REQUEST',
      'A conversa não foi identificada.'
    );
  }

  return {
    conversationId,
    topic,
    screenContext,
    messages: validateMessages(candidate.messages),
  };
};

export const runKyrubConsultant = async (
  rawRequest: unknown,
  user: AuthenticatedConsultantUser,
  provider: AiConsultantProvider = createGeminiConsultantProvider()
): Promise<KyrubAiConsultantResponse> => {
  const request = normalizeConsultantRequest(rawRequest);
  const systemInstruction = buildKyrubConsultantSystemInstruction(
    user,
    request.topic,
    request.screenContext
  );
  const generated = await provider.generate({
    user,
    request,
    messages: request.messages,
    systemInstruction,
  });

  return {
    reply: generated.text,
    provider: provider.name,
    model: generated.model,
    mode: 'conversation',
    requestId: randomUUID(),
    capabilities: {
      actionsEnabled: false,
      voiceEnabled: false,
      persistentCloudHistoryEnabled: false,
    },
  };
};
