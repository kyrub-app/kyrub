import type {
  KyrubAiConsultantRequest,
  KyrubAiConversationMessage,
} from '../../shared/aiConsultant';
import { auth } from '../utils/firebase';
import { loadKyrubiaCatalogAnalysis } from './catalogAnalysisStore';

const OPPORTUNITY_OFFER_PATTERN =
  /(?:caminhos? pr[aá]ticos?|desenvolvimento|renda|comercializ|neg[oó]cio|oportunidad|monetiz|explor(?:ar|asse|e)|aprofundar|possibilidades|mais simples ao mais estrutural)/i;

const AFFIRMATIVE_CONTINUATION_PATTERN =
  /^(?:sim|quero|pode|claro|vamos|gostaria|com certeza|por favor|continue|continua|prossiga|explore|isso)(?:[\s!,.]|$)/i;

const EXPLICIT_NOTE_REQUEST_PATTERN =
  /\b(?:nota|notas|checklist|anote|salv(?:e|ar)|guard(?:e|ar)|registr(?:e|ar)|adicion(?:e|ar))\b/i;

const opportunityAssistantMessage = (
  messages: KyrubAiConversationMessage[]
): KyrubAiConversationMessage | null => {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    return message.content.includes('?') &&
      OPPORTUNITY_OFFER_PATTERN.test(message.content)
      ? message
      : null;
  }
  return null;
};

const withCatalogAnalysisContext = (
  payload: KyrubAiConsultantRequest
): KyrubAiConsultantRequest => {
  if (payload.catalogAnalysisContext) return payload;
  if (typeof localStorage === 'undefined') return payload;
  const uid = auth.currentUser?.uid ?? '';
  if (!uid) return payload;
  const analysis = loadKyrubiaCatalogAnalysis(
    localStorage,
    uid,
    payload.conversationId
  );
  return analysis
    ? { ...payload, catalogAnalysisContext: analysis }
    : payload;
};

export const isKyrubAiOpportunityContinuation = (
  payload: KyrubAiConsultantRequest
): boolean => {
  const latest = payload.messages.at(-1);
  if (!latest || latest.role !== 'user') return false;
  if (!AFFIRMATIVE_CONTINUATION_PATTERN.test(latest.content.trim())) return false;
  if (EXPLICIT_NOTE_REQUEST_PATTERN.test(latest.content)) return false;
  return opportunityAssistantMessage(payload.messages) !== null;
};

export const prepareKyrubAiOpportunityContinuation = (
  payload: KyrubAiConsultantRequest
): KyrubAiConsultantRequest => {
  const contextualPayload = withCatalogAnalysisContext(payload);
  if (!isKyrubAiOpportunityContinuation(contextualPayload)) {
    return contextualPayload;
  }

  const previousAssistant = opportunityAssistantMessage(contextualPayload.messages);
  const latest = contextualPayload.messages.at(-1);
  if (!previousAssistant || !latest) return contextualPayload;

  const continuationInstruction =
    'O usuário aceitou a pergunta de expansão feita pela Kyrubia. Responda em texto, explorando agora caminhos práticos, pessoais, profissionais ou de renda em camadas, do mais simples ao mais estrutural. Não prepare, recrie nem proponha nota ou checklist nesta resposta e não repita a resposta anterior.';

  return {
    ...contextualPayload,
    screenContext: [contextualPayload.screenContext, continuationInstruction]
      .filter(Boolean)
      .join(' '),
    messages: [
      previousAssistant,
      {
        ...latest,
        content:
          `Sim. Estou aceitando sua pergunta para explorar as possibilidades relacionadas ao assunto “${contextualPayload.topic}”. ` +
          'Continue a partir do contexto da sua resposta anterior, apresente os caminhos em camadas e não crie novamente a nota ou o checklist.',
      },
    ],
  };
};
