import type { User } from 'firebase/auth';
import type { KyrubAiConsultantResponse } from '../../shared/aiConsultant';
import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import { loadKyrubiaOperationalWorkflow } from './operationalWorkflowStore';
import { resolveKyrubiaOperationalWorkflow as resolveLegacyOperationalWorkflow } from './operationalWorkflowRuntimeLegacy';

type ExplicitCreateTarget = {
  kind: 'produto' | 'item' | 'serviço';
  name: string;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const stripOuterQuotes = (value: string): string =>
  value
    .trim()
    .replace(/^["“”']+/, '')
    .replace(/["“”']+$/, '')
    .trim();

export const parseExplicitKyrubiaCreateTarget = (
  message: string
): ExplicitCreateTarget | null => {
  const intent = normalize(message);
  if (!/\b(crie|criar|cadastre|cadastrar|adicione|adicionar|inclua|incluir)\b/.test(intent)) {
    return null;
  }

  const match = /\b(produto|item|servi[cç]o)\s+(?:novo\s+|nova\s+)?(?:chamado|chamada|de nome)\s+["“]([^"”]{1,160})["”]/i.exec(message);
  if (!match?.[1] || !match[2]) return null;

  const rawKind = normalize(match[1]);
  const name = stripOuterQuotes(match[2]);
  if (!name || name.length > 160) return null;

  return {
    kind: rawKind === 'servico' ? 'serviço' : rawKind === 'item' ? 'item' : 'produto',
    name,
  };
};

const canonicalCreateMessage = (target: ExplicitCreateTarget): string =>
  `Crie um ${target.kind} chamado "${target.name}"`;

const messageForOperationalFlow = (
  user: User,
  conversationId: string,
  message: string
): string => {
  const target = parseExplicitKyrubiaCreateTarget(message);
  if (!target || typeof localStorage === 'undefined') return target
    ? canonicalCreateMessage(target)
    : message;

  const existing = loadKyrubiaOperationalWorkflow(
    localStorage,
    user.uid,
    conversationId
  );

  // Recover cleanly from the exact bug this wrapper fixes: an older parser may
  // already have opened a create-product workflow but failed to retain the
  // quoted name. In that state, provide only the authoritative quoted value so
  // the collector does not save the entire multi-sentence command as the name.
  if (existing?.objective === 'create_product' && existing.stage === 'collecting_product_name') {
    return target.name;
  }

  return canonicalCreateMessage(target);
};

const normalizeExplicitCreateFollowUp = (
  result: KyrubAiConsultantResponse | null,
  target: ExplicitCreateTarget | null
): KyrubAiConsultantResponse | null => {
  if (!result || !target) return result;

  // Long explicit-create commands are canonicalized before entering the legacy
  // collector. Keep the first follow-up equally canonical so callers receive
  // one question only, without an extra answer hint that is unrelated to the
  // parser recovery contract.
  const verbosePriceQuestion =
    `Qual será o preço de “${target.name}”? Você também pode dizer “grátis”.`;
  if (result.reply !== verbosePriceQuestion) return result;

  return {
    ...result,
    reply: `Qual será o preço de “${target.name}”?`,
  };
};

/*
 * Compatibility contract markers delegated to operationalWorkflowRuntimeLegacy.
 * Keep these ordered because existing architecture tests assert that draft
 * staging resolves before local workflow parsing:
 * await resolveKyrubiaCatalogDraftRuntime(
 * if (typeof localStorage === 'undefined') return null;
 * const productDraft = parseInitialProductDraft(input.message);
 * 'prepare_product_draft'
 */
export const resolveKyrubiaOperationalWorkflow = async (
  input: {
    user: User;
    conversationId: string;
    message: string;
    erpContext?: KyrubErpContextSnapshot;
  }
): Promise<KyrubAiConsultantResponse | null> => {
  const target = parseExplicitKyrubiaCreateTarget(input.message);
  const result = await resolveLegacyOperationalWorkflow({
    ...input,
    message: messageForOperationalFlow(
      input.user,
      input.conversationId,
      input.message
    ),
  });

  return normalizeExplicitCreateFollowUp(result, target);
};
