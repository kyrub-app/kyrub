export type FirestoreFailureKind =
  | 'offline'
  | 'temporarily-unavailable'
  | 'permission-denied'
  | 'unauthenticated'
  | 'unknown';

export interface FirestoreFailure {
  kind: FirestoreFailureKind;
  code: string | null;
  message: string;
}

type UnknownRecord = Record<string, unknown>;

const TEMPORARY_FAILURE_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'aborted',
  'resource-exhausted'
]);

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;

const normalizeCode = (value: unknown): string | null => {
  const code = readString(value)?.toLowerCase();

  if (!code) return null;

  const separatorIndex = code.lastIndexOf('/');
  return separatorIndex >= 0 ? code.slice(separatorIndex + 1) : code;
};

const parseSerializedRecord = (message: string): UnknownRecord | null => {
  try {
    const parsed: unknown = JSON.parse(message);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const extractCodeFromRecord = (record: UnknownRecord): string | null => {
  const directCode = normalizeCode(record.code);
  if (directCode) return directCode;

  if (isRecord(record.cause)) {
    const causeCode = normalizeCode(record.cause.code);
    if (causeCode) return causeCode;
  }

  if (isRecord(record.error)) {
    return extractCodeFromRecord(record.error);
  }

  return null;
};

const extractMessageFromRecord = (record: UnknownRecord): string | null => {
  const directMessage = readString(record.message);
  if (directMessage) return directMessage;

  const errorMessage = readString(record.error);
  if (errorMessage) return errorMessage;

  if (isRecord(record.error)) {
    const nestedErrorMessage = extractMessageFromRecord(record.error);
    if (nestedErrorMessage) return nestedErrorMessage;
  }

  if (isRecord(record.cause)) {
    return extractMessageFromRecord(record.cause);
  }

  return null;
};

const extractFailureDetails = (error: unknown) => {
  if (typeof error === 'string') {
    const message = error.trim() || 'Unknown Firestore error';
    const serialized = parseSerializedRecord(message);

    return {
      code: serialized ? extractCodeFromRecord(serialized) : null,
      message: serialized
        ? extractMessageFromRecord(serialized) ?? 'Unknown Firestore error'
        : message
    };
  }

  if (isRecord(error)) {
    const rawMessage = readString(error.message);
    const serialized = rawMessage ? parseSerializedRecord(rawMessage) : null;

    return {
      code: extractCodeFromRecord(error)
        ?? (serialized ? extractCodeFromRecord(serialized) : null),
      message: serialized
        ? extractMessageFromRecord(serialized) ?? 'Unknown Firestore error'
        : extractMessageFromRecord(error) ?? 'Unknown Firestore error'
    };
  }

  return {
    code: null,
    message: error == null ? 'Unknown Firestore error' : String(error)
  };
};

const inferCodeFromMessage = (message: string): string | null => {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes('missing or insufficient permissions')) {
    return 'permission-denied';
  }

  if (
    normalizedMessage.includes('user is not authenticated')
    || normalizedMessage.includes('user is unauthenticated')
    || normalizedMessage.includes('usuário não autenticado')
    || normalizedMessage.includes('usuario nao autenticado')
    || normalizedMessage.includes('authentication is required')
  ) {
    return 'unauthenticated';
  }

  if (
    normalizedMessage.includes('client is offline')
    || normalizedMessage.includes('network is unavailable')
    || normalizedMessage.includes('network request failed')
    || normalizedMessage.includes('transport error')
    || normalizedMessage.includes('failed to reach the firestore backend')
    || normalizedMessage.includes('could not reach cloud firestore backend')
    || normalizedMessage.includes('rede indisponível')
    || normalizedMessage.includes('rede indisponivel')
    || normalizedMessage.includes('falha de transporte')
  ) {
    return 'unavailable';
  }

  return null;
};

const classifyCode = (code: string | null): FirestoreFailureKind => {
  if (code === 'permission-denied') return 'permission-denied';
  if (code === 'unauthenticated') return 'unauthenticated';
  if (code && TEMPORARY_FAILURE_CODES.has(code)) {
    return 'temporarily-unavailable';
  }

  return 'unknown';
};

export const classifyFirestoreFailure = (
  error: unknown,
  navigatorOnline = true
): FirestoreFailure => {
  const details = extractFailureDetails(error);
  const code = details.code ?? inferCodeFromMessage(details.message);

  return {
    kind: navigatorOnline === false ? 'offline' : classifyCode(code),
    code,
    message: details.message
  };
};
