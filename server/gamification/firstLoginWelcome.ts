/** Pure contract for a one-time welcome grant. No client-provided login counter is trusted. */
export const FIRST_LOGIN_WELCOME_PITANGAS = 1000;
export const FIRST_LOGIN_WELCOME_AWARD_ID = 'first_login_welcome_v1';

export const planFirstLoginWelcome = (input: {
  userId: string;
  authUserCreatedAt: string;
  verifiedFirstSignInAt: string;
}): { userId: string; amount: 1000; awardId: string; occurredAt: string } => {
  if (typeof input.userId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.userId)) {
    throw new Error('WELCOME_USER_INVALID');
  }
  const created = Date.parse(input.authUserCreatedAt);
  const first = Date.parse(input.verifiedFirstSignInAt);
  if (!Number.isFinite(created) || !Number.isFinite(first) ||
      first < created || first - created > 24 * 60 * 60 * 1000) {
    throw new Error('WELCOME_FIRST_LOGIN_UNVERIFIED');
  }
  return {
    userId: input.userId,
    amount: FIRST_LOGIN_WELCOME_PITANGAS,
    awardId: FIRST_LOGIN_WELCOME_AWARD_ID,
    occurredAt: input.verifiedFirstSignInAt,
  };
};
