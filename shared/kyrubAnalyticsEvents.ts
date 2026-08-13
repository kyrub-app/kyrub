export type KyrubAnalyticsLayer = 'product_analytics' | 'economics';

export type KyrubAnalyticsEventName =
  | 'store.viewed'
  | 'store.activated'
  | 'product.viewed'
  | 'order.created'
  | 'order.completed'
  | 'order.cancelled'
  | 'freelance.posted'
  | 'freelance.accepted'
  | 'freelance.completed'
  | 'freelance.cancelled'
  | 'delivery.requested'
  | 'delivery.accepted'
  | 'delivery.completed'
  | 'delivery.cancelled'
  | 'kyrubia.used'
  | 'session.started'
  | 'navigation.area_viewed';

export type KyrubAnalyticsDomain =
  | 'app'
  | 'store'
  | 'catalog'
  | 'order'
  | 'freelance'
  | 'delivery'
  | 'kyrubia';

export type KyrubAnalyticsSource =
  | 'client_observation'
  | 'authoritative_domain_record'
  | 'server_confirmed';

export type KyrubAnalyticsAuthority = 'behavior_only' | 'authoritative_metric';

export interface KyrubAnalyticsEventInput {
  name: KyrubAnalyticsEventName;
  layer: KyrubAnalyticsLayer;
  domain: KyrubAnalyticsDomain;
  source: KyrubAnalyticsSource;
  actorUid: string;
  sessionId?: string;
  entityType?: string;
  entityId?: string;
  storeId?: string;
  amountMinor?: number;
  currency?: 'BRL';
  metadata?: Record<string, string | number | boolean | null>;
}

export const authorityForKyrubAnalyticsSource = (
  source: KyrubAnalyticsSource
): KyrubAnalyticsAuthority =>
  source === 'client_observation' ? 'behavior_only' : 'authoritative_metric';

export const validateKyrubAnalyticsEventInput = (
  input: KyrubAnalyticsEventInput
): string[] => {
  const errors: string[] = [];
  if (!input.actorUid.trim()) errors.push('actor_uid_required');
  const carriesMoney = input.amountMinor !== undefined || input.currency !== undefined;
  if (carriesMoney) {
    if (!Number.isSafeInteger(input.amountMinor) || (input.amountMinor ?? -1) < 0) {
      errors.push('amount_invalid');
    }
    if (input.currency !== 'BRL') errors.push('currency_invalid');
    if (input.source === 'client_observation' || input.layer !== 'economics') {
      errors.push('money_requires_authoritative_economics');
    }
  }
  if (input.layer === 'economics' && input.source === 'client_observation') {
    errors.push('economics_requires_authoritative_source');
  }
  return errors;
};
