export type NormalizedConsultantError = {
  message: string;
  code: string;
};

const DEFAULT_MESSAGE =
  'O Consultor Kyrub está temporariamente indisponível. Tente novamente em instantes.';
const DEFAULT_CODE = 'AI_UNAVAILABLE';
const MAX_DEPTH = 4;

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
): NormalizedConsultantError => ({
  message: findMessage(value) || fallbackMessage,
  code: findCode(value) || fallbackCode,
});
