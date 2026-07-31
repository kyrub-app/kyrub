import type {
  KyrubAiConsultantRequest,
  KyrubAiConversationMessage,
} from '../../shared/aiConsultant';

export type AuthenticatedConsultantUser = {
  uid: string;
  name: string;
  email: string;
};

export type ConsultantGenerationInput = {
  user: AuthenticatedConsultantUser;
  request: KyrubAiConsultantRequest;
  messages: KyrubAiConversationMessage[];
  systemInstruction: string;
};

export type ConsultantGenerationResult = {
  text: string;
  model: string;
};

export interface AiConsultantProvider {
  readonly name: 'gemini';
  generate(input: ConsultantGenerationInput): Promise<ConsultantGenerationResult>;
}

export class ConsultantHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code:
      | 'AUTH_REQUIRED'
      | 'INVALID_REQUEST'
      | 'AI_NOT_CONFIGURED'
      | 'AI_UNAVAILABLE'
      | 'METHOD_NOT_ALLOWED',
    message: string
  ) {
    super(message);
    this.name = 'ConsultantHttpError';
  }
}
