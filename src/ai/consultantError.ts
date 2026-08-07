export type NormalizedConsultantError = {
  message: string;
  code: string;
};

const DEFAULT_MESSAGE =
  'A conversa com a Kyrubia está temporariamente indisponível. Tente novamente em instantes.';
const DEFAULT_CODE = 'AI_UNAVAILABLE';
const MAX_DEPTH = 4;
const PROVIDER_QUOTA_MESSAGE =
  'A capacidade de IA generativa da Kyrubia atingiu temporariamente o limite do provedor. As consultas do Kyrub que não dependem de IA continuam disponíveis. Tente novamente em instantes.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const usefulString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && text !== '[object Object]' ? text : '';
};

const findMessage = (value: unknown, depth = 0): string => {
  const direct = usefulString(value);
  if (direct) return direct;
  if (depth >= MAX_DEPTH) return '';

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findMessage(item, depth + 1);
      if (nested) return nested;
    }
    return '';
  }

  if (!isRecord(value)) return '';

  for (const key of [
    'message',
    'error_description',
    'description',
    'detail',
    'reason',
    'error',
    'errors',
  ]) {
    const nested = findMessage(value[key], depth + 1);
    if (nested) return nested;
  }

  return '';
};

const findCode = (value: unknown, depth = 0): string => {
  if (depth >= MAX_DEPTH) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findCode(item, depth + 1);
      if (nested) return nested;
    }
    return '';
  }
  if (!isRecord(value)) return '';

  const directCode = usefulString(value.code);
  if (directCode) return directCode;

  for (const key of ['error', 'errors', 'cause']) {
    const nested = findCode(value[key], depth + 1);
    if (nested) return nested;
  }

  return '';
};

export const normalizeConsultantError = (
  value: unknown,
  fallbackMessage = DEFAULT_MESSAGE,
  fallbackCode = DEFAULT_CODE
): NormalizedConsultantError => {
  const code = findCode(value) || fallbackCode;
  if (code === 'AI_QUOTA_EXCEEDED' || code === 'AI_PROVIDER_QUOTA_EXCEEDED') {
    return { message: PROVIDER_QUOTA_MESSAGE, code };
  }

  return {
    message: findMessage(value) || fallbackMessage,
    code,
  };
};