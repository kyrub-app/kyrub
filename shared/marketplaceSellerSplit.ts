export type MarketplaceSellerConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'revoked' | 'invalid';

export interface MarketplaceSellerConnection {
  storeId: string;
  provider: 'mercado_pago';
  status: MarketplaceSellerConnectionStatus;
  externalSellerId: string;
  oauthConnectionId: string;
  credentialReference: string;
  connectedByUserId: string;
  connectedAt?: string;
  revokedAt?: string;
}

export interface MarketplaceSplitOneToOnePlan {
  paymentIntentId: string;
  storeId: string;
  sellerExternalId: string;
  grossAmountMinor: number;
  applicationFeeMinor: number;
  sellerAmountMinor: number;
  currency: 'BRL';
  status: 'planned';
}

const required = (value: string, code: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
};

export const assertMarketplaceSellerConnection = (
  connection: MarketplaceSellerConnection
): MarketplaceSellerConnection => {
  required(connection.storeId, 'SELLER_CONNECTION_STORE_REQUIRED');
  required(connection.externalSellerId, 'SELLER_CONNECTION_EXTERNAL_SELLER_REQUIRED');
  required(connection.oauthConnectionId, 'SELLER_CONNECTION_OAUTH_REQUIRED');
  required(connection.credentialReference, 'SELLER_CONNECTION_CREDENTIAL_REFERENCE_REQUIRED');
  required(connection.connectedByUserId, 'SELLER_CONNECTION_USER_REQUIRED');
  if (/access[_-]?token|refresh[_-]?token|bearer\s|secret/i.test(connection.credentialReference)) {
    throw new Error('SELLER_CONNECTION_PLAINTEXT_CREDENTIAL_FORBIDDEN');
  }
  if (connection.status === 'connected' && !connection.connectedAt) {
    throw new Error('SELLER_CONNECTION_CONNECTED_AT_REQUIRED');
  }
  return connection;
};

export const buildMarketplaceSplitOneToOnePlan = (input: {
  paymentIntentId: string;
  connection: MarketplaceSellerConnection;
  grossAmountMinor: number;
  applicationFeeMinor: number;
}): MarketplaceSplitOneToOnePlan => {
  const connection = assertMarketplaceSellerConnection(input.connection);
  if (connection.status !== 'connected') throw new Error('SELLER_CONNECTION_NOT_CONNECTED');
  required(input.paymentIntentId, 'SPLIT_PAYMENT_INTENT_REQUIRED');
  if (!Number.isSafeInteger(input.grossAmountMinor) || input.grossAmountMinor <= 0) {
    throw new Error('SPLIT_GROSS_AMOUNT_INVALID');
  }
  if (!Number.isSafeInteger(input.applicationFeeMinor) || input.applicationFeeMinor < 0) {
    throw new Error('SPLIT_APPLICATION_FEE_INVALID');
  }
  if (input.applicationFeeMinor >= input.grossAmountMinor) {
    throw new Error('SPLIT_APPLICATION_FEE_EXCEEDS_PAYMENT');
  }
  return {
    paymentIntentId: input.paymentIntentId,
    storeId: connection.storeId,
    sellerExternalId: connection.externalSellerId,
    grossAmountMinor: input.grossAmountMinor,
    applicationFeeMinor: input.applicationFeeMinor,
    sellerAmountMinor: input.grossAmountMinor - input.applicationFeeMinor,
    currency: 'BRL',
    status: 'planned',
  };
};

export const splitPlanMovesMoney = (): false => false;
