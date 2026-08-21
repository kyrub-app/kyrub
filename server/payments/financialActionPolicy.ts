export type KyrubFinancialAction =
  | 'create_payment_intent'
  | 'confirm_payment'
  | 'refund_payment'
  | 'cancel_payment'
  | 'release_settlement'
  | 'create_split'
  | 'change_recipient'
  | 'pix_transfer';

export type FinancialAuthority =
  | 'user_confirmation'
  | 'provider_webhook'
  | 'reconciliation'
  | 'admin_break_glass';

export type FinancialActionPolicy = {
  action: KyrubFinancialAction;
  risk: 'medium' | 'high' | 'critical';
  allowedAuthorities: readonly FinancialAuthority[];
  autonomousExecution: false;
  requiresIdempotencyKey: true;
  requiresCorrelationId: true;
  requiresAuthoritativeState: true;
};

const define = (
  action: KyrubFinancialAction,
  risk: FinancialActionPolicy['risk'],
  allowedAuthorities: readonly FinancialAuthority[]
): FinancialActionPolicy => ({
  action,
  risk,
  allowedAuthorities,
  autonomousExecution: false,
  requiresIdempotencyKey: true,
  requiresCorrelationId: true,
  requiresAuthoritativeState: true,
});

export const KYRUB_FINANCIAL_ACTION_POLICY: Record<
  KyrubFinancialAction,
  FinancialActionPolicy
> = {
  create_payment_intent: define('create_payment_intent', 'medium', ['user_confirmation']),
  confirm_payment: define('confirm_payment', 'high', ['provider_webhook', 'reconciliation']),
  refund_payment: define('refund_payment', 'critical', ['user_confirmation', 'admin_break_glass']),
  cancel_payment: define('cancel_payment', 'high', ['user_confirmation', 'provider_webhook']),
  release_settlement: define('release_settlement', 'critical', ['provider_webhook', 'reconciliation', 'admin_break_glass']),
  create_split: define('create_split', 'critical', ['user_confirmation']),
  change_recipient: define('change_recipient', 'critical', ['user_confirmation', 'admin_break_glass']),
  pix_transfer: define('pix_transfer', 'critical', ['user_confirmation']),
};

export type FinancialActionDecision = {
  allowed: boolean;
  reason?:
    | 'AUTONOMY_FORBIDDEN'
    | 'AUTHORITY_NOT_ALLOWED'
    | 'IDEMPOTENCY_REQUIRED'
    | 'CORRELATION_REQUIRED'
    | 'AUTHORITATIVE_STATE_REQUIRED';
};

export const evaluateFinancialAction = (input: {
  action: KyrubFinancialAction;
  authority: FinancialAuthority;
  autonomous?: boolean;
  idempotencyKey?: string;
  correlationId?: string;
  authoritativeStateConfirmed?: boolean;
}): FinancialActionDecision => {
  const policy = KYRUB_FINANCIAL_ACTION_POLICY[input.action];
  if (input.autonomous === true) return { allowed: false, reason: 'AUTONOMY_FORBIDDEN' };
  if (!policy.allowedAuthorities.includes(input.authority)) {
    return { allowed: false, reason: 'AUTHORITY_NOT_ALLOWED' };
  }
  if (!input.idempotencyKey?.trim()) {
    return { allowed: false, reason: 'IDEMPOTENCY_REQUIRED' };
  }
  if (!input.correlationId?.trim()) {
    return { allowed: false, reason: 'CORRELATION_REQUIRED' };
  }
  if (input.authoritativeStateConfirmed !== true) {
    return { allowed: false, reason: 'AUTHORITATIVE_STATE_REQUIRED' };
  }
  return { allowed: true };
};
