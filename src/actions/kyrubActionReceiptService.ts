import type { User } from 'firebase/auth';

const SAFE_ACTION_ENDPOINT = '/api/action-execute';

export type KyrubVerifiedActionReceipt = {
  executionId: string;
  actionType: string;
  proposalId: string;
  entityType: string;
  entityId: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const verifyKyrubActionReceipt = async (
  user: User,
  input: {
    executionId: string;
    actionType: string;
    proposalId: string;
    entityId: string;
  }
): Promise<KyrubVerifiedActionReceipt | null> => {
  let token = '';
  try {
    token = await user.getIdToken();
  } catch {
    return null;
  }

  let response: Response;
  try {
    response = await fetch(SAFE_ACTION_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        operation: 'verify_receipt',
        ...input,
      }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  if (
    !isRecord(body) ||
    body.verified !== true ||
    typeof body.executionId !== 'string' ||
    typeof body.actionType !== 'string' ||
    typeof body.proposalId !== 'string' ||
    typeof body.entityType !== 'string' ||
    typeof body.entityId !== 'string'
  ) {
    return null;
  }

  return {
    executionId: body.executionId,
    actionType: body.actionType,
    proposalId: body.proposalId,
    entityType: body.entityType,
    entityId: body.entityId,
  };
};
