import { GoogleGenAI } from '@google/genai';
import type {
  AiConsultantProvider,
  ConsultantGenerationInput,
  ConsultantGenerationResult,
} from './types';
import { ConsultantHttpError } from './types';

const DEFAULT_MODEL = 'gemini-3.5-flash';

export class GeminiConsultantProvider implements AiConsultantProvider {
  readonly name = 'gemini' as const;
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey: string, model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL) {
    if (!apiKey.trim()) {
      throw new ConsultantHttpError(
        503,
        'AI_NOT_CONFIGURED',
        'A Kyrub I.A ainda não foi ativada neste ambiente.'
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
          temperature: 0.5,
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
      throw new ConsultantHttpError(
        503,
        'AI_UNAVAILABLE',
        'O Consultor Kyrub está temporariamente indisponível. Tente novamente em instantes.'
      );
    }
  }
}

export const createGeminiConsultantProvider = (): GeminiConsultantProvider =>
  new GeminiConsultantProvider(process.env.GEMINI_API_KEY ?? '');
