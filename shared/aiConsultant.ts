export const KYRUB_AI_CONSULTANT_ENDPOINT = '/api/ai/consultant';

export const KYRUB_AI_LIMITS = {
  maxMessagesPerRequest: 24,
  maxMessageCharacters: 4_000,
  maxTotalCharacters: 16_000,
  maxTopicCharacters: 80,
  maxScreenContextCharacters: 240,
} as const;

export type KyrubAiMessageRole = 'user' | 'assistant';

export type KyrubAiConversationMessage = {
  id?: string;
  role: KyrubAiMessageRole;
  content: string;
  createdAt?: string;
};

export type KyrubAiConsultantRequest = {
  conversationId: string;
  topic: string;
  messages: KyrubAiConversationMessage[];
  screenContext?: string;
};

export type KyrubAiConsultantCapabilities = {
  actionsEnabled: boolean;
  voiceEnabled: boolean;
  persistentCloudHistoryEnabled: boolean;
};

export type KyrubAiConsultantResponse = {
  reply: string;
  provider: 'gemini';
  model: string;
  mode: 'conversation';
  requestId: string;
  capabilities: KyrubAiConsultantCapabilities;
};

export type KyrubAiConsultantErrorResponse = {
  error: string;
  code:
    | 'AUTH_REQUIRED'
    | 'INVALID_REQUEST'
    | 'AI_NOT_CONFIGURED'
    | 'AI_UNAVAILABLE'
    | 'METHOD_NOT_ALLOWED';
};
