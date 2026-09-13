import type { User } from 'firebase/auth';
import {
  channelsFromMerchantAnswer,
  type KyrubCommerceChannel,
} from '../../shared/storeConnections';
import { loadStoreConnectionOnboarding } from '../utils/storeConnections';

/**
 * A connected sales channel is not automatically product-preparation capable.
 * Keep this registry intentionally narrow until each provider has a real,
 * provider-authoritative product preparation adapter.
 */
export const KYRUBIA_PRODUCT_PREPARATION_READY_CHANNELS = [
  'mercado_livre',
] as const satisfies readonly KyrubCommerceChannel[];

const PRODUCT_PREPARATION_READY_SET = new Set<KyrubCommerceChannel>(
  KYRUBIA_PRODUCT_PREPARATION_READY_CHANNELS
);

export const kyrubiaProductChannelLabel = (
  channel: KyrubCommerceChannel
): string => {
  switch (channel) {
    case 'mercado_livre': return 'Mercado Livre';
    case 'shopee': return 'Shopee';
    case 'ifood': return 'iFood';
    case '99food': return '99Food';
    case 'instagram': return 'Instagram';
    case 'erp': return 'ERP';
    case 'other': return 'Outro canal';
  }
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

export const loadConnectedKyrubiaProductPreparationChannels = async (
  user: User,
  storeId: string
): Promise<KyrubCommerceChannel[]> => {
  const snapshot = await loadStoreConnectionOnboarding(user, storeId);
  const connected = snapshot.connections
    .filter(connection => connection.status === 'connected')
    .map(connection => connection.channel)
    .filter(channel => PRODUCT_PREPARATION_READY_SET.has(channel));
  return Array.from(new Set(connected));
};

export type KyrubiaProductChannelSelection =
  | { kind: 'selected'; channels: KyrubCommerceChannel[] }
  | { kind: 'kyrub_only'; channels: [] }
  | { kind: 'unresolved'; channels: [] };

export const resolveKyrubiaProductChannelSelection = (
  message: string,
  availableChannels: KyrubCommerceChannel[]
): KyrubiaProductChannelSelection => {
  const available = Array.from(new Set(availableChannels));
  if (available.length === 0) return { kind: 'kyrub_only', channels: [] };

  const intent = normalize(message);
  if (
    /^(?:nao|não|n|somente kyrub|so kyrub|só kyrub|apenas kyrub|kyrub apenas|catalogo kyrub|catálogo kyrub)$/.test(message.trim().toLocaleLowerCase('pt-BR')) ||
    /\b(?:somente|so|só|apenas)\s+(?:no\s+)?kyrub\b/.test(intent)
  ) {
    return { kind: 'kyrub_only', channels: [] };
  }

  if (
    /^(?:sim|s|todos|todas|ambos|ambas|todos os canais|todas as plataformas)$/.test(intent)
  ) {
    return { kind: 'selected', channels: available };
  }

  const requested = channelsFromMerchantAnswer(message)
    .filter(channel => available.includes(channel));
  if (requested.length > 0) {
    return { kind: 'selected', channels: Array.from(new Set(requested)) };
  }

  return { kind: 'unresolved', channels: [] };
};

export const buildKyrubiaProductChannelOffer = (
  productName: string,
  channels: KyrubCommerceChannel[]
): string => {
  const labels = channels.map(kyrubiaProductChannelLabel);
  const joined = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
  const choice = labels.length === 1
    ? `Responda “${labels[0]}” para aproveitar essa preparação ou “somente Kyrub” para seguir apenas com o catálogo interno.`
    : `Responda com os canais desejados, “todos” ou “somente Kyrub”.`;
  return `Identifiquei que sua loja está conectada ${labels.length === 1 ? 'ao' : 'a'} ${joined}. Quer que eu cadastre “${productName}” já preparando também os dados exigidos ${labels.length === 1 ? 'por esse canal' : 'por esses canais'}? O produto continuará canônico no Kyrub e cada plataforma manterá categoria e requisitos próprios. Isso não publica nada externamente. ${choice}`;
};
