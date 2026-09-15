export const EXTERNAL_WRITE_GOVERNANCE_POLICY = Object.freeze({
  localPersistenceGrantsAuthority: false,
  genericConfirmationGrantsAuthority: false,
  authorizationMode: 'explicit_one_time_revalidated',
  crossChannelFanout: 'forbidden',
  retryAfterProviderWriteAttempt: 'reconciliation_only_no_blind_retry',
  reconciliationMode: 'provider_readback_required',
  baselineAdvance: 'exact_target_observed_and_reconciled_only',
  providerStateAuthority: 'external_channel_only_not_inventory',
} as const);

export type ExternalWriteUserSignal =
  | 'explicit_authorization'
  | 'generic_confirmation'
  | 'local_persistence';

export type ExternalWriteAuthorizationConsumptionStatus =
  | 'available'
  | 'reserved'
  | 'consumed'
  | 'reconciliation_required'
  | 'rejected'
  | 'expired';

export interface ExternalWriteTargetScope {
  storeId: string;
  channel: string;
  operationKind: string;
  proposalId: string;
  targetRef: string;
}

export interface ExternalWriteAuthorizationBinding extends ExternalWriteTargetScope {
  authorizationId: string;
  authoritySource: 'explicit_user_authorization';
  authorizedFields: readonly string[];
  protectedFields: readonly string[];
  revalidatedImmediatelyBeforeWrite: boolean;
  consumptionStatus: ExternalWriteAuthorizationConsumptionStatus;
}

export interface ExternalWriteAttemptContext {
  request: ExternalWriteTargetScope;
  authorization?: ExternalWriteAuthorizationBinding | null;
  userSignal: ExternalWriteUserSignal;
  providerWriteAttempted: boolean;
  reconciled: boolean;
}

export type ExternalWriteDenialCode =
  | 'INVALID_REQUEST_SCOPE'
  | 'LOCAL_PERSISTENCE_NOT_AUTHORITY'
  | 'GENERIC_CONFIRMATION_NOT_AUTHORITY'
  | 'EXPLICIT_AUTHORIZATION_REQUIRED'
  | 'AUTHORIZATION_SCOPE_INVALID'
  | 'AUTHORIZATION_SCOPE_MISMATCH'
  | 'AUTHORIZED_FIELDS_REQUIRED'
  | 'AUTHORIZED_FIELD_WILDCARD_FORBIDDEN'
  | 'AUTHORIZED_PROTECTED_FIELD_OVERLAP'
  | 'IMMEDIATE_REVALIDATION_REQUIRED'
  | 'AUTHORIZATION_NOT_AVAILABLE'
  | 'PROVIDER_WRITE_ALREADY_ATTEMPTED'
  | 'ALREADY_RECONCILED';

export type ExternalWriteAttemptDecision =
  | { allowed: true; code: 'ALLOWED' }
  | { allowed: false; code: ExternalWriteDenialCode };

export type ExternalWriteContinuation =
  | 'ready_for_authorization_gate'
  | 'reconciliation_required'
  | 'reconciled';

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const normalizedFields = (fields: readonly string[]): string[] =>
  fields.map(field => clean(field, 120)).filter(Boolean);

const hasValidScope = (scope: ExternalWriteTargetScope): boolean =>
  Boolean(
    clean(scope.storeId) &&
    clean(scope.channel) &&
    clean(scope.operationKind) &&
    clean(scope.proposalId) &&
    clean(scope.targetRef)
  );

const scopeMatches = (
  request: ExternalWriteTargetScope,
  authorization: ExternalWriteAuthorizationBinding
): boolean =>
  request.storeId === authorization.storeId &&
  request.channel === authorization.channel &&
  request.operationKind === authorization.operationKind &&
  request.proposalId === authorization.proposalId &&
  request.targetRef === authorization.targetRef;

export const evaluateExternalWriteAttempt = (
  context: ExternalWriteAttemptContext
): ExternalWriteAttemptDecision => {
  if (!hasValidScope(context.request)) {
    return { allowed: false, code: 'INVALID_REQUEST_SCOPE' };
  }

  if (context.userSignal === 'local_persistence') {
    return { allowed: false, code: 'LOCAL_PERSISTENCE_NOT_AUTHORITY' };
  }
  if (context.userSignal === 'generic_confirmation') {
    return { allowed: false, code: 'GENERIC_CONFIRMATION_NOT_AUTHORITY' };
  }
  if (context.reconciled) {
    return { allowed: false, code: 'ALREADY_RECONCILED' };
  }
  if (context.providerWriteAttempted) {
    return { allowed: false, code: 'PROVIDER_WRITE_ALREADY_ATTEMPTED' };
  }

  const authorization = context.authorization;
  if (!authorization || authorization.authoritySource !== 'explicit_user_authorization') {
    return { allowed: false, code: 'EXPLICIT_AUTHORIZATION_REQUIRED' };
  }
  if (!hasValidScope(authorization) || !clean(authorization.authorizationId)) {
    return { allowed: false, code: 'AUTHORIZATION_SCOPE_INVALID' };
  }
  if (!scopeMatches(context.request, authorization)) {
    return { allowed: false, code: 'AUTHORIZATION_SCOPE_MISMATCH' };
  }

  const authorizedFields = normalizedFields(authorization.authorizedFields);
  const protectedFields = new Set(normalizedFields(authorization.protectedFields));
  if (authorizedFields.length === 0) {
    return { allowed: false, code: 'AUTHORIZED_FIELDS_REQUIRED' };
  }
  if (authorizedFields.some(field => field === '*' || field.includes('*'))) {
    return { allowed: false, code: 'AUTHORIZED_FIELD_WILDCARD_FORBIDDEN' };
  }
  if (authorizedFields.some(field => protectedFields.has(field))) {
    return { allowed: false, code: 'AUTHORIZED_PROTECTED_FIELD_OVERLAP' };
  }
  if (!authorization.revalidatedImmediatelyBeforeWrite) {
    return { allowed: false, code: 'IMMEDIATE_REVALIDATION_REQUIRED' };
  }
  if (authorization.consumptionStatus !== 'available') {
    return { allowed: false, code: 'AUTHORIZATION_NOT_AVAILABLE' };
  }

  return { allowed: true, code: 'ALLOWED' };
};

export const classifyExternalWriteContinuation = (input: {
  providerWriteAttempted: boolean;
  exactTargetObserved: boolean;
  reconciliationPersisted: boolean;
}): ExternalWriteContinuation => {
  if (!input.providerWriteAttempted) return 'ready_for_authorization_gate';
  if (input.exactTargetObserved && input.reconciliationPersisted) return 'reconciled';
  return 'reconciliation_required';
};

export const canAdvanceExternalWriteBaseline = (input: {
  providerWriteAttempted: boolean;
  exactTargetObserved: boolean;
  reconciliationPersisted: boolean;
}): boolean =>
  input.providerWriteAttempted &&
  input.exactTargetObserved &&
  input.reconciliationPersisted;
