/** Pure server policy: inputs must be derived from validated Firebase tokens
 * and authoritative permissions, not browser flags or request bodies. */
export type SecurityResponsibility = 'ordinary' | 'administrative' | 'financial';

export function evaluateKyrubMfa(input: {
  authenticated: boolean;
  responsibility: SecurityResponsibility;
  secondFactor: unknown;
  authTimeSeconds: unknown;
  nowSeconds: number;
  maxAgeSeconds: number;
}): 'allowed' | 'authentication_required' | 'second_factor_required' | 'reauthentication_required' {
  if (input.authenticated !== true) return 'authentication_required';
  if (input.responsibility === 'ordinary') return 'allowed';
  if (input.responsibility !== 'administrative' && input.responsibility !== 'financial') {
    return 'authentication_required';
  }
  // TOTP is the selected candidate. Enrollment alone, Google login or an
  // arbitrary client boolean are not proof of second-factor authentication.
  if (input.secondFactor !== 'totp') return 'second_factor_required';
  const time = input.authTimeSeconds;
  if (typeof time !== 'number' || !Number.isSafeInteger(time) ||
      !Number.isSafeInteger(input.nowSeconds) || !Number.isSafeInteger(input.maxAgeSeconds) ||
      input.maxAgeSeconds <= 0 || time <= 0 || time > input.nowSeconds ||
      input.nowSeconds - time > input.maxAgeSeconds) return 'reauthentication_required';
  return 'allowed';
}
