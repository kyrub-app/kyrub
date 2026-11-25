/**
 * Pure policy foundation. No I/O, authentication, provider or production wiring.
 * All evidence, release policy and current civil date must come from a trusted
 * server boundary, never directly from a client request.
 */
export type AgeStatus =
  | 'pending'
  | 'declared_adult'
  | 'declared_underage'
  | 'verified_adult'
  | 'verified_underage'
  | 'inconclusive'
  | 'suspended';

export type PreliminaryAgeResult =
  | { status: 'declared_adult' | 'declared_underage' }
  | { status: 'pending'; reason: 'invalid_date' | 'future_birth_date' | 'declaration_required' };

const isCivilDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * Preliminary screening only. The caller derives today in the applicable civil
 * timezone. For Feb 29 use a conservative March 1 boundary in non-leap years,
 * pending legal confirmation. Never convert a declaration into verified evidence.
 */
export function screenAge(input: {
  birthDate: string;
  today: string;
  declaredAdult: boolean;
}): PreliminaryAgeResult {
  if (!isCivilDate(input.birthDate) || !isCivilDate(input.today)) {
    return { status: 'pending', reason: 'invalid_date' };
  }
  if (input.birthDate > input.today) {
    return { status: 'pending', reason: 'future_birth_date' };
  }
  const birthday18 = String(Number(input.birthDate.slice(0, 4)) + 18).padStart(4, '0') +
    input.birthDate.slice(4);
  if (input.today < birthday18) return { status: 'declared_underage' };
  if (input.declaredAdult !== true) return { status: 'pending', reason: 'declaration_required' };
  return { status: 'declared_adult' };
}

export type AgeScope = 'public_appropriate' | 'onboarding' | 'support' | 'restricted';
export type AgeReleasePolicy = 'blocked' | 'preliminary_approved' | 'reliable_required';

/**
 * Policy must be resolved per functionality by the server from reviewed,
 * versioned configuration. Default restricted scope is blocked.
 * This gate does not replace authentication, ownership, role or MFA checks.
 */
export function evaluateAgeAccess(input: {
  scope: AgeScope;
  status: AgeStatus;
  authenticated: boolean;
  releasePolicy?: AgeReleasePolicy;
}): boolean {
  if (input.scope === 'public_appropriate' || input.scope === 'support') return true;
  if (input.authenticated !== true) return false;
  if (input.scope === 'onboarding') return true; // screening/appeal only, not protected app data
  if (input.scope !== 'restricted') return false;
  switch (input.releasePolicy) {
    case 'reliable_required':
      return input.status === 'verified_adult';
    case 'preliminary_approved':
      return input.status === 'verified_adult' || input.status === 'declared_adult';
    default:
      return false;
  }
}

/** Normalized trusted provider outcome; no raw document, CPF or selfie. */
export interface AgeEvidence {
  status: 'verified_adult' | 'verified_underage' | 'inconclusive';
  method: string;
  checkedAt: string;
  reference: string;
}
