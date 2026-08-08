import type {
  KyrubActionProposal,
  KyrubReadActionType,
} from './kyrubActions';
import type { KyrubErpContextSnapshot } from './kyrubErpContext';
import type { KyrubiaTurnContext } from './kyrubiaContext';

export type {
  KyrubActionProposal as KyrubAiActionProposal,
  KyrubAiCreateNoteProposal,
} from './kyrubActions';
export type { KyrubErpContextSnapshot } from './kyrubErpContext';
export type { KyrubiaTurnContext } from './kyrubiaContext';

export const KYRUB_AI_CONSULTANT_ENDPOINT = '/api/kyrubia';
export const KYRUB_AI_CONSULTANT_COMPAT_ENDPOINT = '/api/consultor-kyrub';
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

export type KyrubAiHistoricalLink = {
  sourceConversationId: string;
  sourceTitle: string;
  sourceTopic: string;
  sourceUpdatedAt: string;
  linkedAt: string;
  memoryContext: string;
};

export type KyrubAiConsultantRequest = {
  conversationId: string;
  topic: string;
  messages: KyrubAiConversationMessage[];
  screenContext?: string;
  erpContext?: KyrubErpContextSnapshot;
  turnContext?: KyrubiaTurnContext;
  historicalLink?: KyrubAiHistoricalLink;
};

export type KyrubAiConsultantCapabilities = {
  actionsEnabled: boolean;
  enabledActions?: Array<KyrubActionProposal['type']>;
  enabledReadActions?: KyrubReadActionType[];
  voiceEnabled: boolean;
  persistentCloudHistoryEnabled: boolean;
};

export type KyrubAiConsultantResponse = {
  reply: string;
  provider: 'kyrub' | 'gemini';
  model: string;
  mode: 'conversation' | 'deterministic';
  requestId: string;
  actionProposal?: KyrubActionProposal;
  turnContext?: KyrubiaTurnContext;
  historicalLink?: KyrubAiHistoricalLink;
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