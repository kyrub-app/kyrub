import type { User } from 'firebase/auth';
import type {
  KyrubAiPrepareProductDraftProposal,
  KyrubOrderStatus,
} from '../../shared/kyrubActions';
import {
  isKyrubOrderDetailReadIntent,
  resolveKyrubOrderDetailRead,
  type KyrubOrderReadFocus,
} from '../../shared/kyrubOrderReadIntent';
import {
  buildKyrubOrderStatusProposal,
  isKyrubOrderStatusIntent,
} from '../../shared/kyrubOrderStatusProposal';
import {
  buildKyrubProductCompositionProposal,
  isKyrubProductCompositionIntent,
} from '../../shared/kyrubProductCompositionProposal';
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
  readKyrubOrderDetails,
  type KyrubOrderDetails,
} from '../actions/orderReadActionService';
import { emitKyrubAiActionProposal } from './actionEvents';
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

const productCompositionReply = async (
  user: User,
  conversationId: string,
  message: string
): Promise<string> => {
  let erpContext;
  try {
    erpContext = await readKyrubErpContext(user, { force: true });
  } catch {
    return 'Reconheci que você quer criar uma ficha técnica, mas não consegui consultar o catálogo e o estoque privado agora. Nada foi alterado. Tente novamente em instantes.';
  }

  const result = buildKyrubProductCompositionProposal(
    message,
    conversationId,
    erpContext
  );

  if (result.kind === 'needs_context') {
    return result.reason === 'inventory'
      ? 'Reconheci a ficha técnica, mas o estoque privado não está disponível para vincular os insumos com segurança. Nada foi salvo.'
      : 'Reconheci a ficha técnica, mas o catálogo da loja não está disponível para identificar o produto com segurança. Nada foi salvo.';
  }

  if (result.kind === 'needs_product') {
    return 'Reconheci que você quer criar uma ficha técnica, mas não consegui identificar um único produto real do seu catálogo na mensagem. Informe o nome exato do produto e repita os componentes; não vou inventar esse vínculo.';
  }

  if (result.kind === 'needs_lines') {
    return 'Identifiquei o produto, mas uma ou mais linhas da ficha técnica não puderam ser vinculadas com segurança aos insumos reais do estoque ou às unidades cadastradas. Revise os nomes e quantidades; nenhuma composição foi salva.';
  }

  if (result.kind !== 'proposal') {
    return 'Não consegui montar a ficha técnica com segurança. Nada foi alterado.';
  }

  const proposal = result.proposal;
  const lines = proposal.lines
    .map(line => `• ${line.inventoryItemName} — ${line.quantity.toLocaleString('pt-BR')} ${line.unit}`)
    .join('\n');

  emitKyrubAiActionProposal(conversationId, {
    reply: '',
    provider: 'kyrub',
    model: 'kyrub-product-composition-runtime-v1',
    mode: 'deterministic',
    requestId: proposal.id,
    actionProposal: proposal,
    capabilities: {
      actionsEnabled: true,
      enabledActions: ['set_product_composition'],
      enabledReadActions: [],
      voiceEnabled: false,
      persistentCloudHistoryEnabled: false,
    },
  });

  return (
    `Tudo pronto para revisar a ficha técnica de “${proposal.productName}”.\n` +
    `Rendimento: ${proposal.yieldQuantity.toLocaleString('pt-BR')} unidade(s).\n\n${lines}\n\n` +
    'Os componentes foram vinculados aos insumos reais do seu estoque. Salvar a ficha não altera o saldo agora; o consumo continua acontecendo pelo motor de pedidos. Revise e confirme na janela de ficha técnica.'
  );
};

const ORDER_STATUS_LABELS: Record<KyrubOrderStatus, string> = {
  pending: 'Pendente',
  accepted: 'Aceito',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluído',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
};

const orderStatusReply = async (
  user: User,
  conversationId: string,
  message: string
): Promise<string> => {
  let erpContext;
  try {
    erpContext = await readKyrubErpContext(user, { force: true });
  } catch {
    return 'Reconheci que você quer alterar um pedido, mas não consegui consultar os pedidos atuais agora. Nada foi alterado.';
  }

  const result = buildKyrubOrderStatusProposal(message, conversationId, erpContext);
  if (result.kind === 'needs_context') {
    return 'Reconheci a alteração do pedido, mas a leitura de pedidos não está disponível agora. Nada foi alterado.';
  }
  if (result.kind === 'needs_order') {
    if (result.orders.length === 0) {
      return 'Não encontrei pedidos operacionais pendentes para essa alteração. Nada foi modificado.';
    }
    const visible = result.orders.slice(0, 6)
      .map((order, index) => `${index + 1}. ${order.id} — ${ORDER_STATUS_LABELS[order.status as KyrubOrderStatus] ?? order.status}`)
      .join('\n');
    return `Há mais de um pedido que pode ser o alvo. Informe o código do pedido para eu não alterar o pedido errado:\n${visible}`;
  }
  if (result.kind === 'needs_reason') {
    const verb = result.nextStatus === 'cancelled' ? 'cancelar' : 'recusar';
    return `Posso ${verb} o pedido ${result.order.id}, mas preciso registrar o motivo. Diga, por exemplo: “${verb} o pedido ${result.order.id} porque cliente solicitou”.`;
  }
  if (result.kind === 'already_current') {
    return `O pedido ${result.order.id} já está com status “${ORDER_STATUS_LABELS[result.status]}”. Nenhuma alteração é necessária.`;
  }
  if (result.kind === 'invalid_transition') {
    return `O pedido ${result.order.id} está “${ORDER_STATUS_LABELS[result.order.status as KyrubOrderStatus] ?? result.order.status}” e não pode ir diretamente para “${ORDER_STATUS_LABELS[result.nextStatus]}”. Não alterei nada.`;
  }
  if (result.kind !== 'proposal') {
    return 'Não consegui preparar a alteração do pedido com segurança. Nada foi modificado.';
  }

  const proposal = result.proposal;
  emitKyrubAiActionProposal(conversationId, {
    reply: '',
    provider: 'kyrub',
    model: 'kyrub-order-runtime-v1',
    mode: 'deterministic',
    requestId: proposal.id,
    actionProposal: proposal,
    capabilities: {
      actionsEnabled: true,
      enabledActions: ['update_order_status'],
      enabledReadActions: ['list_pending_orders'],
      voiceEnabled: false,
      persistentCloudHistoryEnabled: false,
    },
  });

  const reason = proposal.decision?.reason
    ? `\nMotivo: ${proposal.decision.reason}`
    : '';
  return (
    `Preparei a alteração do pedido ${proposal.orderId}: ` +
    `“${ORDER_STATUS_LABELS[proposal.expectedCurrentStatus]}” → “${ORDER_STATUS_LABELS[proposal.nextStatus]}”.${reason}\n\n` +
    'Nada foi alterado ainda. Revise e confirme na janela do pedido.'
  );
};

const paymentLabel = (status: KyrubOrderDetails['paymentStatus']): string => {
  if (status === 'paid') return 'Pago';
  if (status === 'partial') return 'Parcialmente pago';
  return 'Não pago';
};

const fulfillmentLabel = (order: KyrubOrderDetails, includeLocation: boolean): string => {
  if (order.fulfillmentType === 'delivery') {
    return includeLocation && order.deliveryAddress.trim()
      ? `Entrega — ${order.deliveryAddress.trim()}`
      : 'Entrega';
  }
  if (order.fulfillmentType === 'pickup') return 'Retirada';
  return includeLocation && order.tableCode.trim()
    ? `Consumo no local — mesa/código ${order.tableCode.trim()}`
    : 'Consumo no local';
};

const formatOrderItems = (order: KyrubOrderDetails): string =>
  order.items.map(item => {
    const note = item.note.trim() ? ` · Obs.: ${item.note.trim()}` : '';
    return `- ${item.quantity}x ${item.name} — ${priceLabel(item.price)}${note}`;
  }).join('\n');

const formatOrderDetailReply = (
  order: KyrubOrderDetails,
  focus: KyrubOrderReadFocus
): string => {
  if (focus === 'items') {
    return `Itens do pedido ${order.id}:\n${formatOrderItems(order)}\n\nTotal: ${priceLabel(order.total)}.`;
  }
  if (focus === 'payment') {
    return `Pedido ${order.id}: pagamento “${paymentLabel(order.paymentStatus)}”. Total: ${priceLabel(order.total)}.`;
  }
  if (focus === 'fulfillment') {
    return `Pedido ${order.id}: ${fulfillmentLabel(order, true)}.`;
  }
  if (focus === 'customer_note') {
    return order.customerNote.trim()
      ? `Observação do pedido ${order.id}: ${order.customerNote.trim()}`
      : `O pedido ${order.id} não possui observação geral do cliente.`;
  }

  const buyer = order.buyerName.trim() ? `Cliente: ${order.buyerName.trim()}.\n` : '';
  return (
    `Pedido ${order.id}\n` +
    `${buyer}` +
    `Status: ${ORDER_STATUS_LABELS[order.status] ?? order.status}.\n` +
    `Pagamento: ${paymentLabel(order.paymentStatus)}.\n` +
    `Atendimento: ${fulfillmentLabel(order, false)}.\n` +
    `Total: ${priceLabel(order.total)}.\n` +
    `Itens: ${order.items.reduce((sum, item) => sum + item.quantity, 0)} unidade(s) em ${order.items.length} linha(s).` +
    (order.customerNote.trim() ? `\nObservação: ${order.customerNote.trim()}` : '')
  );
};

const orderDetailReply = async (
  user: User,
  message: string
): Promise<string> => {
  let erpContext;
  try {
    erpContext = await readKyrubErpContext(user, { force: true });
  } catch {
    erpContext = undefined;
  }

  const resolution = resolveKyrubOrderDetailRead(message, erpContext);
  if (resolution.kind === 'needs_context') {
    return 'Não consegui consultar a lista de pedidos agora. Se você tiver o código exato do pedido, pode informá-lo para uma leitura direta.';
  }
  if (resolution.kind === 'needs_order') {
    if (resolution.orders.length === 0) {
      return 'Não encontrei pedidos em andamento nesta leitura. Para consultar um pedido já concluído ou cancelado, informe o código exato dele.';
    }
    const visible = resolution.orders.slice(0, 6)
      .map((order, index) => `${index + 1}. ${order.id} — ${ORDER_STATUS_LABELS[order.status as KyrubOrderStatus] ?? order.status}`)
      .join('\n');
    return `Há mais de um pedido em andamento. Informe o código do pedido que deseja consultar:\n${visible}`;
  }
  if (resolution.kind !== 'resolved') {
    return 'Não consegui identificar qual pedido você quer consultar.';
  }

  let details: KyrubOrderDetails | null = null;
  try {
    details = await readKyrubOrderDetails(user, resolution.orderId);
  } catch {
    return 'O pedido foi identificado, mas não consegui reler os detalhes autoritativos agora. Tente novamente em instantes.';
  }
  if (!details) {
    return `Não encontrei o pedido ${resolution.orderId} nos pedidos desta loja. Nenhum dado foi inferido.`;
  }
  return formatOrderDetailReply(details, resolution.focus);
};

export const resolveKyrubiaCatalogDraftRuntime = async (
  user: User,
  conversationId: string,
  message: string
): Promise<KyrubiaCatalogDraftRuntimeResult | null> => {
  if (isKyrubOrderStatusIntent(message)) {
    return {
      reply: await orderStatusReply(user, conversationId, message),
      model: 'kyrub-catalog-draft-runtime-v1',
    };
  }

  if (isKyrubOrderDetailReadIntent(message)) {
    return {
      reply: await orderDetailReply(user, message),
      model: 'kyrub-catalog-draft-runtime-v1',
    };
  }

  if (isKyrubProductCompositionIntent(message)) {
    return {
      reply: await productCompositionReply(user, conversationId, message),
      model: 'kyrub-catalog-draft-runtime-v1',
    };
  }

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
