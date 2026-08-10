import {
  normalizeSemanticCandidateCatalog,
  normalizeSemanticQuestion,
  normalizeSemanticSelection,
} from '../shared/kyrubKnowledgeSemantic.js';

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

const DEFAULT_FIREBASE_WEB_API_KEY = 'AIzaSyCgWDortDA5DYjx4xIlC9YjKH3ZNIrv99U';
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const REQUEST_TIMEOUT_MS = 10_000;

class SemanticRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SemanticRouteError';
  }
}

const requestBody = (value: unknown): Record<string, unknown> => {
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

const authorizationHeader = (request: VercelRequestLike): string => {
  const value = request.headers.authorization;
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
};

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return { message: text.slice(0, 500) };
  }
};

const nestedMessage = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const candidate = value as Record<string, unknown>;
  for (const key of ['message', 'error', 'detail', 'description', 'reason']) {
    const message = nestedMessage(candidate[key]);
    if (message) return message;
  }
  return '';
};

const verifyFirebaseSession = async (authorization: string): Promise<void> => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new SemanticRouteError(401, 'AUTH_REQUIRED', 'Faça login para usar a interpretação semântica.');
  }

  const firebaseApiKey =
    process.env.FIREBASE_WEB_API_KEY?.trim() ||
    process.env.VITE_FIREBASE_API_KEY?.trim() ||
    DEFAULT_FIREBASE_WEB_API_KEY;

  let response: Response;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ idToken: token }),
      }
    );
  } catch {
    throw new SemanticRouteError(503, 'AUTH_UNAVAILABLE', 'Não foi possível validar sua sessão agora.');
  }

  const payload = await readJson(response);
  const users = Array.isArray(payload.users) ? payload.users : [];
  const account = users[0] && typeof users[0] === 'object'
    ? users[0] as Record<string, unknown>
    : null;
  if (!response.ok || !account || account.disabled === true) {
    throw new SemanticRouteError(401, 'AUTH_REQUIRED', 'Sua sessão expirou ou não pôde ser confirmada.');
  }
};

const extractGeminiText = (payload: Record<string, unknown>): string => {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0] && typeof candidates[0] === 'object'
    ? candidates[0] as Record<string, unknown>
    : null;
  const content = first?.content && typeof first.content === 'object'
    ? first.content as Record<string, unknown>
    : null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return parts
    .map(part => {
      if (!part || typeof part !== 'object') return '';
      const text = (part as Record<string, unknown>).text;
      return typeof text === 'string' ? text : '';
    })
    .join('')
    .trim();
};

const parseModelJson = (value: string): unknown => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(value)?.[1]?.trim() ?? '';
    if (!fenced) return {};
    try {
      return JSON.parse(fenced);
    } catch {
      return {};
    }
  }
};

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike
) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.status(405).json({
      status: 'error',
      code: 'METHOD_NOT_ALLOWED',
      message: 'Use POST para interpretar uma pergunta.',
    });
    return;
  }

  try {
    await verifyFirebaseSession(authorizationHeader(request));

    const body = requestBody(request.body);
    const query = normalizeSemanticQuestion(body.query);
    const candidates = normalizeSemanticCandidateCatalog(body.candidates);
    if (!query || candidates.length === 0) {
      throw new SemanticRouteError(
        400,
        'INVALID_REQUEST',
        'Informe uma pergunta e pelo menos um artigo candidato.'
      );
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
    if (!apiKey) {
      throw new SemanticRouteError(
        503,
        'SEMANTIC_PROVIDER_UNAVAILABLE',
        'A interpretação semântica ainda não está configurada neste ambiente.'
      );
    }

    const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let geminiResponse: Response;
    try {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: [
                  'Você é apenas um roteador semântico de conhecimento oficial do Kyrub.',
                  'Sua única tarefa é escolher quais IDs da lista de artigos melhor correspondem ao significado da pergunta.',
                  'Não responda à pergunta, não explique regras do Kyrub e não crie IDs.',
                  'Se não houver correspondência suficiente, retorne candidateIds vazio e confidence low.',
                  'Retorne somente JSON no formato {"candidateIds":["id"],"confidence":"high|medium|low"}.',
                ].join(' '),
              }],
            },
            contents: [{
              role: 'user',
              parts: [{
                text: `Pergunta: ${JSON.stringify(query)}\nArtigos permitidos (somente id e título): ${JSON.stringify(candidates)}`,
              }],
            }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 120,
              responseMimeType: 'application/json',
            },
          }),
        }
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SemanticRouteError(504, 'SEMANTIC_TIMEOUT', 'A interpretação semântica demorou demais.');
      }
      throw new SemanticRouteError(503, 'SEMANTIC_PROVIDER_UNAVAILABLE', 'A interpretação semântica está indisponível agora.');
    } finally {
      clearTimeout(timeout);
    }

    const payload = await readJson(geminiResponse);
    if (!geminiResponse.ok) {
      const providerMessage = nestedMessage(payload);
      if (geminiResponse.status === 429) {
        throw new SemanticRouteError(
          503,
          'SEMANTIC_PROVIDER_LIMIT',
          'O provedor de interpretação semântica atingiu temporariamente o limite. O Kyrub não vai inventar uma referência.'
        );
      }
      console.warn('[OfficialKnowledgeSemantic] provider rejected request.', providerMessage);
      throw new SemanticRouteError(503, 'SEMANTIC_PROVIDER_UNAVAILABLE', 'A interpretação semântica está indisponível agora.');
    }

    const selection = normalizeSemanticSelection(
      parseModelJson(extractGeminiText(payload)),
      candidates
    );

    response.status(200).json({
      status: 'ok',
      provider: 'gemini',
      model,
      selection,
    });
  } catch (error) {
    if (error instanceof SemanticRouteError) {
      response.status(error.status).json({
        status: 'error',
        code: error.code,
        message: error.message,
      });
      return;
    }

    console.error('[OfficialKnowledgeSemantic] unexpected failure.', error);
    response.status(500).json({
      status: 'error',
      code: 'SEMANTIC_UNEXPECTED_ERROR',
      message: 'Não foi possível interpretar a pergunta agora.',
    });
  }
}
