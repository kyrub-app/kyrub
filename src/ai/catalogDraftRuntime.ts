import type { User } from 'firebase/auth';
import type { KyrubErpContextSnapshot } from '../../shared/kyrubErpContext';
import { readKyrubErpContext } from '../actions/erpReadActionService';
import { emitKyrubAiActionProposal } from './actionEvents';
import {
  isKyrubiaDeterministicProductUpdateIntent,
  resolveKyrubiaDeterministicProductUpdate,
} from './deterministicProductUpdate';
import {
  resolveKyrubiaCatalogDraftRuntime as resolveLegacyCatalogDraftRuntime,
  type KyrubiaCatalogDraftRuntimeResult,
} from './catalogDraftRuntimeLegacy';

export type { KyrubiaCatalogDraftRuntimeResult } from './catalogDraftRuntimeLegacy';

type NaturalProductRenameIntent = {
  currentNameHint: string;
  nextName: string;
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

const naturalProductRenameIntent = (
  message: string
): NaturalProductRenameIntent | null => {
  const normalized = normalize(message);
  const explicitlyRenames =
    /\brenome(?:ie|ar)\b/.test(normalized) ||
    /\b(?:mude|mudar|troque|trocar|altere|alterar)\b[^.!?\n]{0,36}\bnome\b/.test(normalized);
  if (!explicitlyRenames) return null;

  const nextMatch = /\b(?:renomeie|renomear|mude|mudar|troque|trocar|altere|alterar)\b[^.!?\n]{0,220}?\bpara\s+["“]([^"”]{1,160})["”]/i.exec(message);
  const nextName = stripOuterQuotes(nextMatch?.[1] ?? '');
  if (!nextName) return null;

  const namedProduct = /\b(?:produto|item|servi[cç]o)\s+(?:chamado|chamada|de nome)\s+["“]([^"”]{1,160})["”]/i.exec(message);
  let currentNameHint = stripOuterQuotes(namedProduct?.[1] ?? '');

  if (!currentNameHint) {
    const quoted = Array.from(message.matchAll(/["“]([^"”]{1,160})["”]/g))
      .map(match => stripOuterQuotes(match[1] ?? ''))
      .filter(Boolean);
    currentNameHint = quoted.find(value => normalize(value) !== normalize(nextName)) ?? '';
  }

  if (!currentNameHint || normalize(currentNameHint).length < 3) return null;
  return { currentNameHint, nextName };
};

const canonicalRenameMessage = (
  currentName: string,
  nextName: string
): string => `Altere o nome do produto "${currentName}" para "${nextName}"`;

const readProductContextSafely = async (
  user: User
): Promise<KyrubErpContextSnapshot | undefined> => {
  try {
    return await readKyrubErpContext(user, { force: true });
  } catch (error) {
    console.warn(
      '[Kyrubia] Product update context is temporarily unavailable.',
      error
    );
    return undefined;
  }
};

const resolveProductUpdate = async (
  user: User,
  conversationId: string,
  message: string
): Promise<KyrubiaCatalogDraftRuntimeResult | null> => {
  const naturalRename = naturalProductRenameIntent(message);
  const deterministicIntent = isKyrubiaDeterministicProductUpdateIntent(message);
  if (!naturalRename && !deterministicIntent) return null;

  const context = await readProductContextSafely(user);
  let effectiveMessage = message;

  if (naturalRename && context?.availability.products === true) {
    const hint = normalize(naturalRename.currentNameHint);
    const exact = context.products.filter(product => normalize(product.name) === hint);
    const candidates = exact.length > 0
      ? exact
      : context.products.filter(product => normalize(product.name).includes(hint));

    if (candidates.length > 1) {
      const names = candidates
        .slice(0, 6)
        .map(product => `• ${product.name}`)
        .join('\n');
      return {
        reply:
          `Encontrei mais de um produto compatível com “${naturalRename.currentNameHint}”:\n${names}\n\n` +
          'Diga o nome exato do produto que deve ser renomeado. Não vou escolher um item por suposição.',
        model: 'kyrub-catalog-draft-runtime-v1',
      };
    }

    if (candidates.length === 1) {
      effectiveMessage = canonicalRenameMessage(
        candidates[0].name,
        naturalRename.nextName
      );
    } else {
      effectiveMessage = canonicalRenameMessage(
        naturalRename.currentNameHint,
        naturalRename.nextName
      );
    }
  } else if (naturalRename) {
    effectiveMessage = canonicalRenameMessage(
      naturalRename.currentNameHint,
      naturalRename.nextName
    );
  }

  const resolved = resolveKyrubiaDeterministicProductUpdate(
    effectiveMessage,
    context
  );
  if (!resolved) return null;

  if (resolved.actionProposal) {
    emitKyrubAiActionProposal(conversationId, {
      reply: resolved.reply,
      provider: 'kyrub',
      model: 'kyrub-product-update-runtime-v1',
      mode: 'deterministic',
      requestId: resolved.actionProposal.id,
      actionProposal: resolved.actionProposal,
      capabilities: {
        actionsEnabled: true,
        enabledActions: ['update_product'],
        enabledReadActions: ['list_products'],
        voiceEnabled: false,
        persistentCloudHistoryEnabled: false,
      },
    });
  }

  return {
    reply: resolved.reply,
    model: 'kyrub-catalog-draft-runtime-v1',
  };
};

/*
 * Compatibility contract markers delegated to catalogDraftRuntimeLegacy:
 * resolveKyrubiaDeterministicProductDraft
 * executePreauthorizedProductDraftAction
 * listKyrubCatalogDrafts
 * isKyrubOrderStatusIntent / orderStatusReply
 * isKyrubOrderDetailReadIntent / orderDetailReply
 * isKyrubProductCompositionIntent / productCompositionReply
 * isKyrubiaStorefrontTestRequest / storefrontTestReply
 * nenhum produto foi publicado
 */
export const resolveKyrubiaCatalogDraftRuntime = async (
  user: User,
  conversationId: string,
  message: string
): Promise<KyrubiaCatalogDraftRuntimeResult | null> => {
  const productUpdate = await resolveProductUpdate(
    user,
    conversationId,
    message
  );
  if (productUpdate) return productUpdate;

  return resolveLegacyCatalogDraftRuntime(user, conversationId, message);
};
