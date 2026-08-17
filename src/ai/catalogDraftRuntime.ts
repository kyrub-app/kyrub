import type { User } from 'firebase/auth';
import type { KyrubAiPrepareProductDraftProposal } from '../../shared/kyrubActions';
import { resolveKyrubiaDeterministicProductDraft } from '../../shared/kyrubiaDeterministicProductDraft';
import {
  isKyrubiaStorefrontTestRequest,
  selectKyrubiaStorefrontTestProducts,
  type KyrubiaStorefrontTestCandidate,
} from '../../shared/kyrubiaStorefrontTestIntent';
import { readKyrubErpContext } from '../actions/erpReadActionService';
import { executePreauthorizedProductDraftAction } from '../actions/kyrubActionService';
import { listKyrubCatalogDrafts } from '../actions/kyrubCatalogDraftService';
import {
  KYRUBIA_STOREFRONT_TEST_PROPOSAL_EVENT,
  type KyrubiaStorefrontTestProposalEventDetail,
} from './storefrontTestEvents';

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

const storefrontTestCandidateFromDraft = (
  draft: Awaited<ReturnType<typeof listKyrubCatalogDrafts>>['drafts'][number]
): KyrubiaStorefrontTestCandidate | null => {
  const name = draft.product.name?.trim() ?? '';
  const category = draft.product.category?.trim() ?? '';
  const price = draft.product.price;
  if (!name || !category || typeof price !== 'number' || !Number.isFinite(price)) {
    return null;
  }
  return {
    id: draft.id,
    name,
    category,
    price,
    hasDescription: Boolean(draft.product.description?.trim()),
    hasImage: Boolean(draft.product.image?.trim()),
  };
};

const emitStorefrontTestProposal = (
  conversationId: string,
  selection: NonNullable<ReturnType<typeof selectKyrubiaStorefrontTestProducts>>
): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<KyrubiaStorefrontTestProposalEventDetail>(
      KYRUBIA_STOREFRONT_TEST_PROPOSAL_EVENT,
      {
        detail: {
          conversationId,
          items: [selection.main, selection.dessert],
        },
      }
    )
  );
};

const storefrontTestReply = async (
  user: User,
  conversationId: string
): Promise<string> => {
  const [draftResult, erpContext] = await Promise.all([
    listKyrubCatalogDrafts(user),
    readKyrubErpContext(user, { force: true }),
  ]);

  if (erpContext.store?.configured !== true) {
    return 'Entendi que o objetivo é preparar produtos existentes para um teste de compra, não configurar o perfil da loja. Porém sua Loja Kyrub ainda precisa estar ativada antes de eu conseguir preparar a vitrine.';
  }

  const candidates = draftResult.drafts.flatMap(draft => {
    const candidate = storefrontTestCandidateFromDraft(draft);
    return candidate ? [candidate] : [];
  });
  const selection = selectKyrubiaStorefrontTestProducts(candidates);
  if (!selection) {
    return 'Entendi o teste de compra e consultei seus produtos não publicados, mas não encontrei ao mesmo tempo um lanche/hambúrguer e uma sobremesa completos o suficiente para publicar. Não criei nota nem alterei a loja. Posso revisar os rascunhos com você para identificar o dado que está faltando.';
  }

  const alreadyPublishedCount = Math.max(0, Math.trunc(erpContext.productCount));
  if (erpContext.store.plan === 'free' && alreadyPublishedCount + 2 > 5) {
    const remaining = Math.max(0, 5 - alreadyPublishedCount);
    return `Entendi o objetivo e encontrei “${selection.main.name}” e “${selection.dessert.name}” para o teste. Sua loja, porém, tem espaço para publicar apenas ${remaining} novo(s) item(ns) no plano Free. Não publiquei nada. Para manter o teste como lanche + sobremesa, primeiro precisamos liberar duas vagas ou fazer upgrade do plano.`;
  }

  emitStorefrontTestProposal(conversationId, selection);

  const missingDetails = [
    !selection.main.hasDescription ? `${selection.main.name}: descrição não informada` : null,
    !selection.main.hasImage ? `${selection.main.name}: imagem não informada` : null,
    !selection.dessert.hasDescription ? `${selection.dessert.name}: descrição não informada` : null,
    !selection.dessert.hasImage ? `${selection.dessert.name}: imagem não informada` : null,
  ].filter(Boolean);
  const reviewNote = missingDetails.length > 0
    ? `\n\nPara transparência, encontrei estes dados opcionais ainda ausentes: ${missingDetails.join('; ')}. Não vou inventá-los nem bloquear este teste por isso.`
    : '';

  return (
    `Entendi o objetivo: preparar uma compra de teste, não configurar sua loja. Consultei os rascunhos e proponho publicar somente estes dois itens:\n` +
    `1. ${selection.main.name} — ${selection.main.category} — ${priceLabel(selection.main.price)}\n` +
    `2. ${selection.dessert.name} — ${selection.dessert.category} — ${priceLabel(selection.dessert.price)}\n\n` +
    `Vou manter os dados reais já cadastrados e as categorias extraídas do cardápio, sem inventar ficha técnica, ingredientes ou observações. Os demais produtos continuarão não publicados. Nada será enviado à vitrine sem sua confirmação na tela.` +
    reviewNote
  );
};

export const resolveKyrubiaCatalogDraftRuntime = async (
  user: User,
  conversationId: string,
  message: string
): Promise<KyrubiaCatalogDraftRuntimeResult | null> => {
  // Compound business goals must win over isolated keywords such as
  // “configure” + “loja”. This runs before store-activation routing so the
  // object of the request (existing products) remains authoritative.
  if (isKyrubiaStorefrontTestRequest(message)) {
    return {
      reply: await storefrontTestReply(user, conversationId),
      model: 'kyrub-catalog-draft-runtime-v1',
    };
  }

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
