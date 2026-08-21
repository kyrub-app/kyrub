import type { KyrubActiveActionType } from './kyrubActions';

export const KYRUB_PREVIEW_AUTHORIZATION_SCHEMA_VERSION = 1 as const;

export type KyrubPreviewAuthorization = {
  schemaVersion: typeof KYRUB_PREVIEW_AUTHORIZATION_SCHEMA_VERSION;
  authorizationId: string;
  previewId: string;
  proposalHash: string;
  expectedStateHash: string;
  actorUid: string;
  correlationId: string;
  actionType: KyrubActiveActionType;
  authorizationMode: 'human_confirmation';
  authorizedAt: string;
  expiresAt: string;
  singleUse: true;
};
