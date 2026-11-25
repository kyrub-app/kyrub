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
  const yearDifference = Number(input.today.slice(0, 4)) - Number(input.birthDate.slice(0, 4));
  if (yearDifference < 18 || (yearDifference === 18 && input.today.slice(4) < input.birthDate.slice(4))) {
    return { status: 'declared_underage' };
  }
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
  // Restricted operations must name their capability and use its reviewed policy.
  return false;
}

/** Normalized trusted provider outcome; no raw document, CPF or selfie. */
export interface AgeEvidence {
  status: 'verified_adult' | 'verified_underage' | 'inconclusive';
  method: string;
  checkedAt: string;
  reference: string;
}


/**
 * Explicit capability allowlist. Inconclusive does not mean adult. A reviewed
 * personal-only release permits only the enumerated private/educational
 * capabilities. No new capability inherits that exception automatically.
 */
export type AgeCapability =
  | 'private_notes' | 'private_tasks' | 'appropriate_courses' | 'private_tag_management'
  | 'tag_publication' | 'social_publication' | 'social_comment' | 'sowing'
  | 'connections' | 'messages' | 'communities' | 'tribes'
  | 'store_erp' | 'freelance' | 'delivery' | 'financial_operations' | 'rewards';

export type CapabilityAgePolicy = 'blocked' | 'verified_adult_only' | 'reviewed_personal_only';
const PERSONAL_ONLY: ReadonlySet<AgeCapability> = new Set([
  'private_notes', 'private_tasks', 'appropriate_courses', 'private_tag_management',
]);
const KNOWN_CAPABILITIES: ReadonlySet<AgeCapability> = new Set([
  ...PERSONAL_ONLY, 'tag_publication', 'social_publication', 'social_comment', 'sowing',
  'connections', 'messages', 'communities', 'tribes', 'store_erp', 'freelance',
  'delivery', 'financial_operations', 'rewards',
]);

/** Server-resolved policy only; not a substitute for ownership or role checks. */
export function evaluateCapabilityAgeAccess(input: {
  capability: AgeCapability;
  status: AgeStatus;
  authenticated: boolean;
  policy?: CapabilityAgePolicy;
}): boolean {
  if (input.authenticated !== true || !KNOWN_CAPABILITIES.has(input.capability)) return false;
  if (input.policy === 'verified_adult_only') return input.status === 'verified_adult';
  if (input.policy !== 'reviewed_personal_only' || !PERSONAL_ONLY.has(input.capability)) return false;
  return input.status === 'verified_adult' || input.status === 'inconclusive';
}
