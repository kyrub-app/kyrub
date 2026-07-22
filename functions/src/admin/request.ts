export interface AdminStatusRequest {
  requestId: string;
}

export class InvalidAdminRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAdminRequestError';
  }
}

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

export const isSafeOperationIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && REQUEST_ID_PATTERN.test(value.trim());

export const parseAdminStatusRequest = (value: unknown): AdminStatusRequest => {
  if (!value || typeof value !== 'object') {
    throw new InvalidAdminRequestError('Payload administrativo inválido.');
  }

  const requestId = (value as Record<string, unknown>).requestId;
  if (!isSafeOperationIdentifier(requestId)) {
    throw new InvalidAdminRequestError(
      'requestId deve conter entre 16 e 128 caracteres seguros.'
    );
  }

  return { requestId: requestId.trim() };
};
