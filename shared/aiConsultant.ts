import type {
  KyrubActionProposal,
  KyrubReadActionType,
} from './kyrubActions';
import type { KyrubCatalogAnalysis } from './kyrubCatalogAnalysis';
import type { KyrubErpContextSnapshot } from './kyrubErpContext';
import type { KyrubInventoryTransformationProposal } from './kyrubInventoryTransformation';
import type { KyrubiaTurnContext } from './kyrubiaContext';

export type {
  KyrubActionProposal,
  KyrubActionProposal as KyrubRegisteredAiActionProposal,
  KyrubAiCreateNoteProposal,
  KyrubAiImportCatalogDraftProposal,
} from './kyrubActions';
export type { KyrubInventoryTransformationProposal } from './kyrubInventoryTransformation';
export type { KyrubCatalogAnalysis } from './kyrubCatalogAnalysis';
export type { KyrubErpContextSnapshot } from './kyrubErpContext';
export type {
  KyrubiaOfferedIntent,
  KyrubiaOfferedIntentKind,
  KyrubiaTurnContext,
} from './kyrubiaContext';

export type KyrubAiActionProposal =
  | KyrubActionProposal
  | KyrubInventoryTransformationProposal;

export const KYRUB_AI_CONSULTANT_ENDPOINT = '/api/consultor-kyrub';
export const KYRUB_AI_CATALOG_ANALYSIS_ENDPOINT = '/api/consultor-kyrub';
export const KYRUB_AI_CONSULTANT_COMPAT_ENDPOINT = '/api/kyrubia';
export const KYRUB_AI_CONSULTANT_LEGACY_ENDPOINT = '/api/ai/consultant';

export const KYRUB_AI_LIMITS = {
  maxMessagesPerRequest: 24,
  maxMessageCharacters: 4_000,
  maxTotalCharacters: 16_000,
  maxTopicCharacters: 80,
  maxScreenContextCharacters: 240,
} as const;

export const KYRUB_AI_ATTACHMENT_LIMITS = {
  maxFilesPerMessage: 4,
  maxImageBytes: 8 * 1024 * 1024,
  maxPdfBytes: 10 * 1024 * 1024,
  maxTotalBytesPerMessage: 16 * 1024 * 1024,
  maxNameCharacters: 160,
} as const;

export type KyrubAiAttachmentMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf';

export type KyrubAiAttachmentRef = {
  id: string;
  name: string;
  mimeType: KyrubAiAttachmentMimeType;
  size: number;
  storagePath: string;
};

export type KyrubAiMessageRole = 'user' | 'assistant';

export type KyrubAiConversationMessage = {
  id?: string;
  role: KyrubAiMessageRole;
  content: string;
  createdAt?: string;
  /**
   * Private Firebase Storage references owned by the authenticated user.
   * Bytes are never persisted in conversation localStorage.
   */
  attachments?: KyrubAiAttachmentRef[];
  /**
   * Read-only structured interpretation produced by analyze_catalog.
   * It is conversational context, never mutation authority.
   */
  catalogAnalysis?: KyrubCatalogAnalysis;
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
  /**
   * Latest structured catalog analysis rehydrated only for the authenticated
   * UID + current conversation. The server treats it as untrusted context,
   * never as authorization, receipt or proof of a write.
   */
  catalogAnalysisContext?: KyrubCatalogAnalysis;
  /**
   * ID of a structured option displayed by Kyrub. Selecting it expresses
   * conversational intent only and never grants mutation authority.
   */
  selectedOfferedIntentId?: string;
  historicalLink?: KyrubAiHistoricalLink;
};

export type KyrubAiConsultantCapabilities = {
  actionsEnabled: boolean;
  enabledActions?: Array<
    KyrubActionProposal['type'] | KyrubInventoryTransformationProposal['type']
  >;
  enabledReadActions?: KyrubReadActionType[];
  voiceEnabled: boolean;
  persistentCloudHistoryEnabled: boolean;
  multimodalAttachmentsEnabled?: boolean;
  catalogAnalysisEnabled?: boolean;
  providerResilienceEnabled?: boolean;
  usageMeteringEnabled?: boolean;
};

export type KyrubAiConsultantResponse = {
  reply: string;
  provider: 'kyrub' | 'gemini';
  model: string;
  mode: 'conversation' | 'deterministic';
  requestId: string;
  actionProposal?: KyrubAiActionProposal;
  catalogAnalysis?: KyrubCatalogAnalysis;
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
