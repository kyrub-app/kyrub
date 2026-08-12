export type KyrubActivityEventType =
  | 'navigation.screen_viewed'
  | 'navigation.community_opened'
  | 'interaction.action_attempted'
  | 'result.action_succeeded'
  | 'result.action_failed';

export type KyrubActivityEventDomain =
  | 'app'
  | 'community'
  | 'store'
  | 'catalog'
  | 'order'
  | 'reservation'
  | 'kyrubia';

export type KyrubActivityEventSource =
  | 'client_observation'
  | 'authoritative_write_ack'
  | 'server_confirmed';

export type KyrubActivityEventAuthority =
  | 'context_only'
  | 'confirmed_result';

export type KyrubActivityMetadataValue = string | number | boolean | null;

export interface KyrubActivityEventInput {
  type: KyrubActivityEventType;
  domain: KyrubActivityEventDomain;
  source: KyrubActivityEventSource;
  screenId?: string;
  actionId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, KyrubActivityMetadataValue>;
}

export interface KyrubActivityEvent extends KyrubActivityEventInput {
  schemaVersion: 1;
  id: string;
  actorUid: string;
  occurredAt: string;
  authority: KyrubActivityEventAuthority;
}

export const authorityForKyrubActivitySource = (
  source: KyrubActivityEventSource
): KyrubActivityEventAuthority =>
  source === 'client_observation' ? 'context_only' : 'confirmed_result';
