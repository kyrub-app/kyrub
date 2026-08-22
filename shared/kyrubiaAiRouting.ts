export type KyrubiaAiProviderId =
  | 'google-gemini'
  | 'openai'
  | 'anthropic'
  | 'custom';

export type KyrubiaAiFundingSource =
  | 'user_provider'
  | 'kyrubia_credits'
  | 'platform_legacy'
  | 'none';

export type KyrubiaAiWorkload =
  | 'deterministic'
  | 'llm_text'
  | 'llm_multimodal';

export type KyrubiaPaidFallbackConsent =
  | 'none'
  | 'once'
  | 'automatic';

export interface KyrubiaUserProviderState {
  connected: boolean;
  available: boolean;
  provider?: KyrubiaAiProviderId;
}

export interface KyrubiaCreditsState {
  enabled: boolean;
  balance: number;
}

export interface KyrubiaAiRouteInput {
  workload: KyrubiaAiWorkload;
  userProvider: KyrubiaUserProviderState;
  credits: KyrubiaCreditsState;
  paidFallbackConsent?: KyrubiaPaidFallbackConsent;
}

export type KyrubiaAiRouteDecision =
  | {
      mode: 'deterministic';
      fundingSource: 'none';
      consumeCredits: false;
      reason: 'llm_not_required';
    }
  | {
      mode: 'user_provider';
      fundingSource: 'user_provider';
      consumeCredits: false;
      provider: KyrubiaAiProviderId;
      reason: 'user_provider_available';
    }
  | {
      mode: 'kyrubia_credits';
      fundingSource: 'kyrubia_credits';
      consumeCredits: true;
      reason: 'credits_mode' | 'paid_fallback_approved';
    }
  | {
      mode: 'consent_required';
      fundingSource: 'none';
      consumeCredits: false;
      reason: 'provider_failed_paid_fallback_requires_consent';
    }
  | {
      mode: 'blocked';
      fundingSource: 'none';
      consumeCredits: false;
      reason:
        | 'provider_configuration_invalid'
        | 'provider_unavailable_without_credits'
        | 'provider_or_credits_required';
    };

const hasCredits = (credits: KyrubiaCreditsState): boolean =>
  credits.enabled && Number.isFinite(credits.balance) && credits.balance > 0;

export const decideKyrubiaAiRoute = (
  input: KyrubiaAiRouteInput
): KyrubiaAiRouteDecision => {
  if (input.workload === 'deterministic') {
    return {
      mode: 'deterministic',
      fundingSource: 'none',
      consumeCredits: false,
      reason: 'llm_not_required',
    };
  }

  if (input.userProvider.connected && input.userProvider.available) {
    if (!input.userProvider.provider) {
      return {
        mode: 'blocked',
        fundingSource: 'none',
        consumeCredits: false,
        reason: 'provider_configuration_invalid',
      };
    }
    return {
      mode: 'user_provider',
      fundingSource: 'user_provider',
      consumeCredits: false,
      provider: input.userProvider.provider,
      reason: 'user_provider_available',
    };
  }

  if (input.userProvider.connected && !input.userProvider.available) {
    if (!hasCredits(input.credits)) {
      return {
        mode: 'blocked',
        fundingSource: 'none',
        consumeCredits: false,
        reason: 'provider_unavailable_without_credits',
      };
    }

    const consent = input.paidFallbackConsent ?? 'none';
    if (consent === 'once' || consent === 'automatic') {
      return {
        mode: 'kyrubia_credits',
        fundingSource: 'kyrubia_credits',
        consumeCredits: true,
        reason: 'paid_fallback_approved',
      };
    }

    return {
      mode: 'consent_required',
      fundingSource: 'none',
      consumeCredits: false,
      reason: 'provider_failed_paid_fallback_requires_consent',
    };
  }

  if (hasCredits(input.credits)) {
    return {
      mode: 'kyrubia_credits',
      fundingSource: 'kyrubia_credits',
      consumeCredits: true,
      reason: 'credits_mode',
    };
  }

  return {
    mode: 'blocked',
    fundingSource: 'none',
    consumeCredits: false,
    reason: 'provider_or_credits_required',
  };
};
