/**
 * Authenticated API adapter for external store-team invitations.
 * No automatic delivery or acceptance: caller must explicitly share the issued token.
 */
export type ExternalTeamInviteRole = 'manager' | 'cashier' | 'seller' | 'production';

export type IssuedExternalTeamInvitation = {
  invitationId: string;
  token: string;
  expiresAt: string;
};

const postInvitation = async <T>(
  action: 'issue' | 'claim',
  idToken: string,
  payload: Record<string, unknown>
): Promise<T> => {
  if (!idToken.trim()) throw new Error('Faça login novamente.');
  const response = await fetch(`/api/store-team-invitations/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body &&
      typeof body.error === 'string' ? body.error : 'Não foi possível processar o convite.';
    throw new Error(message);
  }
  return response.json() as Promise<T>;
};

export const issueExternalTeamInvitation = (
  idToken: string,
  input: { storeId: string; recipientEmail: string; role: ExternalTeamInviteRole }
): Promise<IssuedExternalTeamInvitation> =>
  postInvitation('issue', idToken, input);

export const claimExternalTeamInvitation = (
  idToken: string,
  input: { storeId: string; invitationId: string; token: string }
): Promise<{ storeId: string; status: 'invited' }> =>
  postInvitation('claim', idToken, input);
