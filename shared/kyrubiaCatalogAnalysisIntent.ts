import type { KyrubAiConversationMessage } from './aiConsultant';

const CATALOG_CONTEXT = /\b(cat[aá]logo|card[aá]pio|menu|lista\s+de\s+pre[cç]os?|tabela\s+de\s+pre[cç]os?|portf[oó]lio\s+de\s+(?:produtos|servi[cç]os)|rela[cç][aã]o\s+de\s+(?:produtos|servi[cç]os)|mix\s+de\s+produtos|sku(?:s)?|vitrine\s+de\s+produtos)\b/i;
const ANALYSIS_ACTION = /\b(analis\w*|organiz\w*|interpret\w*|extra\w*|identific\w*|mape\w*|estrutur\w*|revis\w*|leia|ler|liste|listar|quais?)\b/i;

export const isKyrubiaCatalogAnalysisText = (value: string): boolean => {
  const text = value.replace(/\s+/g, ' ').trim();
  return Boolean(text && CATALOG_CONTEXT.test(text) && ANALYSIS_ACTION.test(text));
};

export const shouldUseKyrubiaCatalogAnalysis = (
  messages: KyrubAiConversationMessage[]
): boolean => {
  const latestUserMessage = [...messages]
    .reverse()
    .find(message => message.role === 'user');
  return latestUserMessage
    ? isKyrubiaCatalogAnalysisText(latestUserMessage.content)
    : false;
};
