import type { User } from 'firebase/auth';
import type { KyrubAiPrepareProductDraftProposal } from '../../shared/kyrubActions';
import { resolveKyrubiaDeterministicProductDraft } from '../../shared/kyrubiaDeterministicProductDraft';
import { executePreauthorizedProductDraftAction } from '../actions/kyrubActionService';
import { listKyrubCatalogDrafts } from '../actions/kyrubCatalogDraftService';

export type KyrubiaCatalogDraftRuntimeResult = {
  reply: string;
  model: 'kyrub-catalog-draft-runtime-v1';
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\bq\b/g, 'que')
    .replace(/\s+/g, ' ')
    .trim();

const stableHash = (value: string): string => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
};

const safeConversationId = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'conversation';

const asksToListDrafts = (message: string): boolean => {
  const intent = normalize(message);
  const mentionsDraft = /\brascunhos?\b/.test(intent);
  const mentionsCatalog = /\b(catalogo|produto|produtos|itens)\b/.test(intent);
  const asksList = /\b(liste|listar|mostre|mostrar|quais|tenho|veja|ver)\b/.test(intent);
  return mentionsDraft && mentionsCatalog && asksList;
};

const priceLabel = (value: number | undefined): string => {
  if (value === undefined) return 'preço pendente';
  return `R$ ${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const draftListReply = async (user: User): Promise<string> => {
  const { drafts } = await listKyrubCatalogDrafts(user);
  if (drafts.length === 0) {
    return 'Você ainda não tem rascunhos de catálogo preparados. Nenhum produto publicado é contado como rascunho.';
  }

  const visible = drafts.slice(0, 10);
  const lines = visible.map((draft, index) => {
    const pending = draft.issues.length > 0
      ? ` — ${draft.issues.length} pendência${draft.issues.length === 1 ? '' : 's'}`
      : '';
    return `${index + 1}. ${draft.product.name} — ${priceLabel(draft.product.price)}${pending}`;
  });
  const remainder = drafts.length > visible.length
    ? `\n\nHá mais ${drafts.length - visible.length} rascunho(s) além destes.`
    : '';

  return `Seus rascunhos privados de catálogo:\n${lines.join('\n')}${remainder}\n\nNenhum desses itens foi publicado no catálogo da loja.`;
};

export const resolveKyrubiaCatalogDraftRuntime = async (
  user: User,
  conversationId: string,
  message: string
): Promise<KyrubiaCatalogDraftRuntimeResult | null> => {
  const prepared = resolveKyrubiaDeterministicProductDraft(message);
  if (prepared) {
    const fingerprint = stableHash(`${conversationId}:${message}`);
    const proposalId = `product-draft-${fingerprint}`;
    const proposal: KyrubAiPrepareProductDraftProposal = {
      id: proposalId,
      type: 'prepare_product_draft',
      product: prepared.product,
      source: {
        kind: 'conversation',
        conversationId: safeConversationId(conversationId),
      },
      fieldProvenance: prepared.fieldProvenance,
      issues: prepared.issues,
      requiresConfirmation: false,
      origin: 'kyrubia',
      risk: 'low',
      inputProvenance: 'user_intent',
      impact: { entityCount: 1, reversibility: 'easy' },
      idempotencyKey: `kyrubia:prepare_product_draft:${safeConversationId(conversationId)}:${fingerprint}`,
    };

    await executePreauthorizedProductDraftAction(user, proposal);

    const explicitFields = [
      prepared.product.price !== undefined ? priceLabel(prepared.product.price) : null,
      prepared.product.stock !== undefined ? `estoque ${prepared.product.stock}` : null,
      prepared.product.category ? `categoria “${prepared.product.category}”` : null,
    ].filter(Boolean).join(', ');
    const pending = prepared.issues.length > 0
      ? ` Ficaram ${prepared.issues.length} pendência(s) sinalizada(s) para revisão.`
      : '';

    return {
      reply:
        `Rascunho preparado para “${prepared.product.name}”${explicitFields ? ` (${explicitFields})` : ''}. ` +
        `Ele foi salvo somente na área privada de preparação; nenhum produto foi publicado ou consumiu vaga do seu plano.${pending}`,
      model: 'kyrub-catalog-draft-runtime-v1',
    };
  }

  if (asksToListDrafts(message)) {
    return {
      reply: await draftListReply(user),
      model: 'kyrub-catalog-draft-runtime-v1',
    };
  }

  return null;
};
