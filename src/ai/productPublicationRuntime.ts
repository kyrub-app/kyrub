import type { User } from 'firebase/auth';
import type { KyrubAiSetProductPublicationProposal } from '../../shared/kyrubActions';
import { parseKyrubProductPublicationIntent } from '../../shared/kyrubProductPublicationIntent';
import { readKyrubErpContext } from '../actions/erpReadActionService';
import { listKyrubCatalogDrafts } from '../actions/kyrubCatalogDraftService';

export type KyrubProductPublicationResolution = {
  reply: string;
  actionProposal?: KyrubAiSetProductPublicationProposal;
};

const createRequestId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-product-publication-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const proposalFor = (
  productId: string,
  productName: string,
  published: boolean
): KyrubAiSetProductPublicationProposal => ({
  id: createRequestId(),
  type: 'set_product_publication',
  productId,
  productName,
  expectedCurrentStatus: published ? 'draft' : 'published',
  published,
  requiresConfirmation: true,
  origin: 'kyrubia',
  risk: 'medium',
  inputProvenance: 'user_intent',
  impact: { entityCount: 1, reversibility: 'easy' },
});

export const resolveKyrubProductPublication = async (
  user: User,
  message: string
): Promise<KyrubProductPublicationResolution | null> => {
  const intent = parseKyrubProductPublicationIntent(message);
  if (!intent) return null;
  const target = normalize(intent.productName);

  if (intent.published) {
    let drafts;
    try {
      drafts = (await listKyrubCatalogDrafts(user)).drafts;
    } catch {
      return {
        reply: 'Entendi que você quer publicar um produto, mas não consegui consultar os rascunhos canônicos agora. Nada foi publicado.',
      };
    }
    const matches = drafts.filter(draft => normalize(draft.product.name ?? '') === target);
    if (matches.length > 1) {
      return {
        reply: `Encontrei mais de um rascunho chamado “${intent.productName}”. Não vou escolher um deles por suposição.`,
      };
    }
    if (matches.length === 1) {
      const draft = matches[0];
      return {
        reply: `Encontrei o rascunho “${draft.product.name}”. Vou propor a publicação na vitrine. O servidor ainda validará os campos obrigatórios e o limite do seu plano; nada será publicado antes da sua confirmação.`,
        actionProposal: proposalFor(draft.id, draft.product.name, true),
      };
    }

    try {
      const erp = await readKyrubErpContext(user, { force: true });
      const alreadyPublished = erp.products.some(product => normalize(product.name) === target);
      if (alreadyPublished) {
        return { reply: `“${intent.productName}” já está publicado. Nenhuma alteração é necessária.` };
      }
    } catch {
      // A ausência no conjunto canônico de rascunhos já é suficiente para não agir.
    }
    return {
      reply: `Não encontrei um rascunho chamado “${intent.productName}”. Nenhuma publicação foi proposta.`,
    };
  }

  let erp;
  try {
    erp = await readKyrubErpContext(user, { force: true });
  } catch {
    return {
      reply: 'Entendi que você quer despublicar um produto, mas não consegui consultar o catálogo publicado agora. Nada foi alterado.',
    };
  }

  const matches = erp.products.filter(product => normalize(product.name) === target);
  if (matches.length > 1) {
    return {
      reply: `Encontrei mais de um produto publicado chamado “${intent.productName}”. Não vou escolher um deles por suposição.`,
    };
  }
  if (matches.length === 0) {
    return {
      reply: erp.productsTruncated
        ? `Não encontrei “${intent.productName}” na parte publicada do catálogo disponível nesta leitura. Como a lista está parcial, não vou adivinhar qual produto retirar da vitrine.`
        : `Não encontrei um produto publicado chamado “${intent.productName}”. Nenhuma alteração foi proposta.`,
    };
  }

  const product = matches[0];
  return {
    reply: `Encontrei “${product.name}” no catálogo publicado. Vou propor que ele volte para rascunho e saia da vitrine. Nada será alterado antes da sua confirmação.`,
    actionProposal: proposalFor(product.id, product.name, false),
  };
};
