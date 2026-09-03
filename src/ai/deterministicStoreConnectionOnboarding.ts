import {
  channelsFromMerchantAnswer,
  type KyrubCommerceChannel,
} from '../../shared/storeConnections.js';

export type KyrubiaStoreConnectionDeclarationResolution = {
  answer: string;
  channels: KyrubCommerceChannel[];
  kind: 'channels_declared' | 'no_external_channels';
};

const normalizeIntentText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const FUTURE_OR_CONNECTION_INTENT = /(?:\?|\bcomo\b|\bposso\b|\bquero\s+(?:conectar|integrar|importar|sincronizar|cadastrar|publicar|vender)\b|\bpretendo\s+vender\b|\bvou\s+vender\b|\bpreciso\s+(?:conectar|integrar|importar|sincronizar)\b|\bconect(?:ar|e|o)\b|\bintegr(?:ar|acao)\b|\bimport(?:ar|acao)\b|\bsincroniz(?:ar|acao)\b)/;

const EXPLICIT_DECLARATION = /\b(?:ja\s+vendo|eu\s+vendo|vendo|vendemos|minha\s+loja\s+vende|a\s+gente\s+vende|tambem\s+vendo|uso\s+.+\s+para\s+vender|trabalho\s+com)\b/;

const NEGATIVE_DECLARATION = /(?:\bnao\s+(?:vendo|vendemos|uso|temos|tenho)\b[^.]{0,80}\b(?:outro|nenhum|fora|canal|lugar)\b|\bso\s+vendo\s+(?:no|pelo)\s+kyrub\b|\bsomente\s+(?:no|pelo)\s+kyrub\b)/;

const isBareChannelAnswer = (value: string): boolean => {
  const remainder = normalizeIntentText(value)
    .replace(/mercado\s*livre/g, ' ')
    .replace(/shopee/g, ' ')
    .replace(/i\s*food/g, ' ')
    .replace(/99\s*food/g, ' ')
    .replace(/instagram|insta/g, ' ')
    .replace(/\berp\b/g, ' ')
    .replace(/[,&/+]/g, ' ')
    .replace(/\b(?:e|no|na|nos|nas|tambem|so|somente|apenas)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return remainder.length === 0;
};

export const storeConnectionChannelLabel = (channel: KyrubCommerceChannel): string => {
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

export const resolveKyrubiaStoreConnectionDeclarationIntent = (
  message: string
): KyrubiaStoreConnectionDeclarationResolution | null => {
  const answer = message.trim();
  if (!answer) return null;

  const normalized = normalizeIntentText(answer);
  if (NEGATIVE_DECLARATION.test(normalized)) {
    return { answer, channels: [], kind: 'no_external_channels' };
  }

  const channels = channelsFromMerchantAnswer(answer);
  if (channels.length === 0) return null;
  if (FUTURE_OR_CONNECTION_INTENT.test(normalized)) return null;

  if (!EXPLICIT_DECLARATION.test(normalized) && !isBareChannelAnswer(answer)) {
    return null;
  }

  return { answer, channels, kind: 'channels_declared' };
};
