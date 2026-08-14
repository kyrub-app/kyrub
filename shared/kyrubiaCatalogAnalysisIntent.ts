import type { KyrubAiConversationMessage } from './aiConsultant';

const CATALOG_CONTEXT = /\b(cat[aá]logo|card[aá]pio|menu|lista\s+de\s+pre[cç]os?|tabela\s+de\s+pre[cç]os?|portf[oó]lio\s+de\s+(?:produtos|servi[cç]os)|rela[cç][aã]o\s+de\s+(?:produtos|servi[cç]os)|mix\s+de\s+produtos|sku(?:s)?|vitrine\s+de\s+produtos)\b/i;
const ANALYSIS_ACTION = /\b(analis\w*|organiz\w*|interpret\w*|extra\w*|identific\w*|mape\w*|estrutur\w*|revis\w*|leia|ler|liste|listar|quais?)\b/i;
const CATALOG_FOLLOWUP = /(?:\b(?:dessa|desse|deste|daquela|daquele)\s+(?:lista|an[aá]lise|resultado|material|cat[aá]logo)\b|\b(?:os?|as?)\s+(?:(?:\d+|tr[eê]s|dois|duas|quatro|cinco)\s+)?(?:primeir[oa]s?|[uú]ltim[oa]s?)\b|\bquais?\b.{0,100}\b(?:precisam?|necessitam?|revis[aã]o|revisar)\b)/i;

export const isKyrubiaCatalogAnalysisText = (value: string): boolean => {
  const text = value.replace(/\s+/g, ' ').trim();
  return Boolean(text && CATALOG_CONTEXT.test(text) && ANALYSIS_ACTION.test(text));
};

export const isKyrubiaCatalogAnalysisFollowupText = (value: string): boolean => {
  const text = value.replace(/\s+/g, ' ').trim();
  return Boolean(text && CATALOG_FOLLOWUP.test(text));
};

export const shouldUseKyrubiaCatalogAnalysis = (
  messages: KyrubAiConversationMessage[],
  hasCatalogAnalysisContext = false
): boolean => {
  const latestUserMessage = [...messages]
    .reverse()
    .find(message => message.role === 'user');
  if (!latestUserMessage) return false;
  return isKyrubiaCatalogAnalysisText(latestUserMessage.content) ||
    (hasCatalogAnalysisContext &&
      isKyrubiaCatalogAnalysisFollowupText(latestUserMessage.content));
};
