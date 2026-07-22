export interface AdminStatusRequest {
  requestId: string;
}

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

export const isSafeOperationIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && REQUEST_ID_PATTERN.test(value.trim());

export const parseAdminStatusRequest = (value: unknown): AdminStatusRequest => {
  if (!value || typeof value !== 'object') {
    throw new Error('Payload administrativo inválido.');
  }

  const requestId = (value as Record<string, unknown>).requestId;
  if (!isSafeOperationIdentifier(requestId)) {
    throw new Error(
      'requestId deve conter entre 16 e 128 caracteres seguros.'
    );
  }

  return { requestId: requestId.trim() };
};
