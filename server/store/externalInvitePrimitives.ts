import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const normalizeExternalInviteEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};

export const hashExternalInviteToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const generateExternalInviteToken = (): { token: string; hash: string } => {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashExternalInviteToken(token) };
};

export const verifyExternalInviteToken = (token: string, hash: string): boolean => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hashExternalInviteToken(token), 'hex'), Buffer.from(hash, 'hex'));
};

export const externalInviteClaimEligible = (input: {
  invitationEmail: string;
  authenticatedEmail: string;
  emailVerified: boolean;
  status: string;
  expiresAt: number;
  now: number;
}): boolean => Boolean(
  input.emailVerified &&
  input.status === 'issued' &&
  Number.isFinite(input.expiresAt) &&
  input.expiresAt > input.now &&
  normalizeExternalInviteEmail(input.invitationEmail) &&
  normalizeExternalInviteEmail(input.invitationEmail) === normalizeExternalInviteEmail(input.authenticatedEmail)
);
