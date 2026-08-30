import {
  channelsFromMerchantAnswer,
  type KyrubCommerceChannel,
} from './storeConnections.js';

export interface StoreCommerceChannelDeclaration {
  schemaVersion: 1;
  storeId: string;
  channels: KyrubCommerceChannel[];
  source: 'merchant_onboarding';
  authority: 'store_owner';
  declaredByUserId: string;
  declaredAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const VALID_CHANNELS = new Set<KyrubCommerceChannel>([
  'mercado_livre',
  'shopee',
  'ifood',
  '99food',
  'instagram',
  'erp',
  'other',
]);

export const normalizeCommerceChannels = (
  value: unknown
): KyrubCommerceChannel[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap(item => {
    const channel = clean(item) as KyrubCommerceChannel;
    return VALID_CHANNELS.has(channel) ? [channel] : [];
  })));
};

export const buildStoreCommerceChannelDeclaration = (input: {
  storeId: string;
  channels: KyrubCommerceChannel[];
  declaredByUserId: string;
  declaredAt: string;
}): StoreCommerceChannelDeclaration => {
  const storeId = clean(input.storeId);
  const declaredByUserId = clean(input.declaredByUserId);
  const declaredAt = clean(input.declaredAt);
  const channels = normalizeCommerceChannels(input.channels);
  if (!storeId || !declaredByUserId || storeId !== declaredByUserId) {
    throw new Error('STORE_CHANNEL_DECLARATION_SCOPE_INVALID');
  }
  if (!declaredAt || Number.isNaN(Date.parse(declaredAt))) {
    throw new Error('STORE_CHANNEL_DECLARATION_TIMESTAMP_INVALID');
  }
  return {
    schemaVersion: 1,
    storeId,
    channels,
    source: 'merchant_onboarding',
    authority: 'store_owner',
    declaredByUserId,
    declaredAt,
  };
};

export const buildStoreCommerceChannelDeclarationFromAnswer = (input: {
  storeId: string;
  answer: string;
  declaredByUserId: string;
  declaredAt: string;
}): StoreCommerceChannelDeclaration =>
  buildStoreCommerceChannelDeclaration({
    storeId: input.storeId,
    channels: channelsFromMerchantAnswer(input.answer),
    declaredByUserId: input.declaredByUserId,
    declaredAt: input.declaredAt,
  });
