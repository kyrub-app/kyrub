import { GoogleGenAI } from '@google/genai';
import type {
  AiConsultantProvider,
  ConsultantGenerationInput,
  ConsultantGenerationResult,
} from './types';
import { ConsultantHttpError } from './types';

const DEFAULT_MODEL = 'gemini-3.6-flash';

const errorDetails = (error: unknown): { status: number; text: string } => {
  const candidate = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  const statusCandidate = candidate.status ?? candidate.statusCode ?? candidate.code;
  const status = typeof statusCandidate === 'number'
    ? statusCandidate
    : Number(statusCandidate);
  const text = error instanceof Error
    ? `${error.name}: ${error.message}`
    : typeof error === 'string'
      ? error
      : JSON.stringify(candidate);
  return {
    status: Number.isFinite(status) ? status : 0,
    text,
  };
};

const mapGeminiError = (error: unknown, model: string): ConsultantHttpError => {
  const details = errorDetails(error);

  if (
    details.status === 401 ||
    details.status === 403 ||
    /API_KEY_INVALID|API key not valid|invalid api key|permission denied/i.test(details.text)
  ) {
    return new ConsultantHttpError(
      503,
      'AI_NOT_CONFIGURED',
      'A chave do Gemini não foi aceita ou ainda não foi configurada no servidor do Kyrub.'
    );
  }

  if (
    details.status === 404 ||
    /model[^\n]*(not found|does not exist|unsupported)|NOT_FOUND/i.test(details.text)
  ) {
    return new ConsultantHttpError(
      503,
      'AI_MODEL_UNAVAILABLE',
      `O modelo ${model} não está disponível para esta chave do Gemini.`
    );
  }

  if (
    details.status === 429 ||
    /RESOURCE_EXHAUSTED|quota|rate.?limit|too many requests/i.test(details.text)
  ) {
    return new ConsultantHttpError(
      429,
      'AI_QUOTA_EXCEEDED',
      'O limite de uso do Gemini foi atingido. Tente novamente mais tarde.'
    );
  }

  return new ConsultantHttpError(
    503,
    'AI_UNAVAILABLE',
    'O Consultor Kyrub está temporariamente indisponível. Tente novamente em instantes.'
  );
};

export class GeminiConsultantProvider implements AiConsultantProvider {
  readonly name = 'gemini' as const;
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(
    apiKey: string,
    model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL
  ) {
    if (!apiKey.trim()) {
      throw new ConsultantHttpError(
        503,
        'AI_NOT_CONFIGURED',
        'A chave do Gemini ainda não foi configurada no servidor do Kyrub.'
      );
    }
    this.client = new GoogleGenAI({ apiKey: apiKey.trim() });
    this.model = model;
  }

  async generate(
    input: ConsultantGenerationInput
  ): Promise<ConsultantGenerationResult> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: input.messages.map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        config: {
          systemInstruction: input.systemInstruction,
          maxOutputTokens: 1_200,
        },
      });

      const text = response.text?.trim() ?? '';
      if (!text) {
        throw new Error('O Gemini retornou uma resposta vazia.');
      }

      return { text, model: this.model };
    } catch (error) {
      if (error instanceof ConsultantHttpError) throw error;
      console.error('[Kyrub AI] Gemini generation failed.', error);
      throw mapGeminiError(error, this.model);
    }
  }
}

export const createGeminiConsultantProvider = (): GeminiConsultantProvider =>
  new GeminiConsultantProvider(process.env.GEMINI_API_KEY ?? '');
