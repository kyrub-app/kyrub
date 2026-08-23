export type StoreOAuthFlowStatus =
  | 'created'
  | 'redirected'
  | 'callback_received'
  | 'authorized'
  | 'failed'
  | 'expired';

export interface StoreOAuthAuthorizationFlow {
  id: string;
  storeId: string;
  provider: string;
  requestedByUserId: string;
  status: StoreOAuthFlowStatus;
  stateHash: string;
  pkceChallenge?: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
}

export interface StoreOAuthCallbackEnvelope {
  flowId: string;
  state: string;
  authorizationCode: string;
}

const required = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const assertStoreOAuthFlow = (
  flow: StoreOAuthAuthorizationFlow
): StoreOAuthAuthorizationFlow => {
  required(flow.id, 'oauth.id');
  required(flow.storeId, 'oauth.storeId');
  required(flow.provider, 'oauth.provider');
  required(flow.requestedByUserId, 'oauth.requestedByUserId');
  required(flow.stateHash, 'oauth.stateHash');
  if (Date.parse(flow.expiresAt) <= Date.parse(flow.createdAt)) {
    throw new Error('STORE_OAUTH_EXPIRY_INVALID');
  }
  return flow;
};

export const assertStoreOAuthCallback = (
  callback: StoreOAuthCallbackEnvelope
): StoreOAuthCallbackEnvelope => {
  required(callback.flowId, 'oauth.callback.flowId');
  required(callback.state, 'oauth.callback.state');
  required(callback.authorizationCode, 'oauth.callback.authorizationCode');
  return callback;
};

/** Browser receives only an authorization URL/flow id. Provider tokens stay backend→Vault. */
export interface StoreOAuthBrowserStartResult {
  flowId: string;
  authorizationUrl: string;
}
