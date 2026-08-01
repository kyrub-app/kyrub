export const KYRUB_AI_CONSULTANT_ENDPOINT = '/api/kyrubia';
export const KYRUB_AI_CONSULTANT_LEGACY_ENDPOINT = '/api/ai/consultant';

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

export type KyrubAiCreateNoteProposal = {
  id: string;
  type: 'create_note';
  title: string;
  content: string;
  checklist: string[];
  requiresConfirmation: true;
};

export type KyrubAiActionProposal = KyrubAiCreateNoteProposal;

export type KyrubAiConsultantCapabilities = {
  actionsEnabled: boolean;
  enabledActions?: Array<KyrubAiActionProposal['type']>;
  voiceEnabled: boolean;
  persistentCloudHistoryEnabled: boolean;
};

export type KyrubAiConsultantResponse = {
  reply: string;
  provider: 'gemini';
  model: string;
  mode: 'conversation';
  requestId: string;
  actionProposal?: KyrubAiActionProposal;
  capabilities: KyrubAiConsultantCapabilities;
};

export type KyrubAiConsultantErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'AI_NOT_CONFIGURED'
  | 'AI_MODEL_UNAVAILABLE'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_UNAVAILABLE'
  | 'METHOD_NOT_ALLOWED';

export type KyrubAiConsultantErrorResponse = {
  error: string;
  code: KyrubAiConsultantErrorCode;
};
