import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  Pencil,
  ShoppingBag,
  X,
} from 'lucide-react';
import type {
  KyrubAiSetProductPublicationProposal,
  KyrubAiUpdateProductProposal,
  KyrubProductPatch,
} from '../../shared/kyrubActions';
import { executeKyrubAction } from '../actions/kyrubActionService';
import { invalidateKyrubErpContext } from '../actions/erpReadActionService';
import { setKyrubCatalogProductPublished } from '../actions/kyrubCatalogDraftService';
import {
  KYRUB_AI_ACTION_PROPOSAL_EVENT,
  type KyrubAiActionProposalEventDetail,
} from '../ai/actionEvents';
import {
  KYRUBIA_STOREFRONT_TEST_PROPOSAL_EVENT,
  type KyrubiaStorefrontTestProposalEventDetail,
} from '../ai/storefrontTestEvents';
import { auth } from '../utils/firebase';

type ConfirmationState = 'reviewing' | 'executing' | 'success' | 'error';

type PendingProductUpdate = {
  kind: 'product_update';
  conversationId: string;
  proposal: KyrubAiUpdateProductProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

type PendingProductPublication = {
  kind: 'product_publication';
  conversationId: string;
  proposal: KyrubAiSetProductPublicationProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

type PendingStorefrontTest = {
  kind: 'storefront_test';
  detail: KyrubiaStorefrontTestProposalEventDetail;
  state: ConfirmationState;
  errorMessage: string;
};

type PendingConfirmation =
  | PendingProductUpdate
  | PendingProductPublication
  | PendingStorefrontTest;

const withIdempotency = <T extends KyrubAiUpdateProductProposal | KyrubAiSetProductPublicationProposal>(
  conversationId: string,
  proposal: T
): T => ({
  ...proposal,
  origin: proposal.origin ?? 'kyrubia',
  risk: proposal.risk ?? 'medium',
  idempotencyKey:
    proposal.idempotencyKey ??
    `kyrubia:${proposal.type}:${conversationId}:${proposal.id}`,
});

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const PRODUCT_FIELD_LABELS: Record<keyof KyrubProductPatch, string> = {
  name: 'Nome',
  description: 'Descrição',
  price: 'Preço',
  category: 'Categoria',
  image: 'Imagem',
};

const productPatchRows = (patch: KyrubProductPatch) =>
  (Object.entries(patch) as Array<[keyof KyrubProductPatch, string | number]>).map(
    ([field, value]) => ({
      field,
      label: PRODUCT_FIELD_LABELS[field],
      value: field === 'price' && typeof value === 'number'
        ? currency.format(value)
        : field === 'image' && String(value).trim() === ''
          ? 'Remover imagem atual'
          : field === 'description' && String(value).trim() === ''
            ? 'Remover descrição atual'
            : String(value),
    })
  );

export function KyrubAiProductUpdateActionBridge() {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubAiActionProposalEventDetail>).detail;
      if (!detail) return;
      if (detail.proposal.type === 'update_product') {
        setPending({
          kind: 'product_update',
          conversationId: detail.conversationId,
          proposal: withIdempotency(detail.conversationId, detail.proposal),
          state: 'reviewing',
          errorMessage: '',
          alreadyApplied: false,
        });
        return;
      }
      if (detail.proposal.type === 'set_product_publication') {
        setPending({
          kind: 'product_publication',
          conversationId: detail.conversationId,
          proposal: withIdempotency(detail.conversationId, detail.proposal),
          state: 'reviewing',
          errorMessage: '',
          alreadyApplied: false,
        });
      }
    };

    const handleStorefrontTest = (event: Event) => {
      const detail = (
        event as CustomEvent<KyrubiaStorefrontTestProposalEventDetail>
      ).detail;
      if (!detail || detail.items.length !== 2) return;
      setPending({
        kind: 'storefront_test',
        detail,
        state: 'reviewing',
        errorMessage: '',
      });
    };

    window.addEventListener(KYRUB_AI_ACTION_PROPOSAL_EVENT, handleProposal);
    window.addEventListener(
      KYRUBIA_STOREFRONT_TEST_PROPOSAL_EVENT,
      handleStorefrontTest
    );
    return () => {
      window.removeEventListener(KYRUB_AI_ACTION_PROPOSAL_EVENT, handleProposal);
      window.removeEventListener(
        KYRUBIA_STOREFRONT_TEST_PROPOSAL_EVENT,
        handleStorefrontTest
      );
    };
  }, []);

  if (!pending) return null;

  const close = () => {
    if (pending.state === 'executing') return;
    setPending(null);
  };

  const confirmOfficialAction = async (
    current: PendingProductUpdate | PendingProductPublication
  ) => {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Faça login novamente antes de confirmar esta alteração.');
    }
    const result = await executeKyrubAction(user, current.proposal, true);
    invalidateKyrubErpContext(user.uid);
    setPending(value => value && value.kind === current.kind ? {
      ...value,
      state: 'success',
      errorMessage: '',
      alreadyApplied: result.status === 'already_applied',
    } : value);
  };

  const confirmStorefrontTest = async (current: PendingStorefrontTest) => {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Faça login novamente antes de publicar os itens do teste.');
    }

    const publishedIds: string[] = [];
    try {
      for (const item of current.detail.items) {
        await setKyrubCatalogProductPublished(user, item.id, true);
        publishedIds.push(item.id);
      }
    } catch (error) {
      await Promise.allSettled(
        publishedIds.map(productId =>
          setKyrubCatalogProductPublished(user, productId, false)
        )
      );
      throw error;
    }

    invalidateKyrubErpContext(user.uid);
    setPending(value => value?.kind === 'storefront_test' ? {
      ...value,
      state: 'success',
      errorMessage: '',
    } : value);
  };

  const confirm = async () => {
    if (pending.state === 'executing') return;
    const current = pending;
    setPending(value => value ? {
      ...value,
      state: 'executing',
      errorMessage: '',
    } : value);

    try {
      if (current.kind === 'storefront_test') {
        await confirmStorefrontTest(current);
      } else {
        await confirmOfficialAction(current);
      }
    } catch (error) {
      setPending(value => value ? {
        ...value,
        state: 'error',
        errorMessage: error instanceof Error
          ? error.message
          : current.kind === 'storefront_test'
            ? 'Não foi possível preparar os dois itens para a vitrine.'
            : current.kind === 'product_publication'
              ? 'Não foi possível alterar a publicação do produto.'
              : 'Não foi possível atualizar o produto.',
      } : value);
    }
  };

  const isWorking = pending.state === 'executing';
  const isSuccess = pending.state === 'success';
  const storefrontTest = pending.kind === 'storefront_test';
  const publication = pending.kind === 'product_publication';
  const changes = pending.kind === 'product_update'
    ? productPatchRows(pending.proposal.patch)
    : [];
  const publicationVerb = publication
    ? pending.proposal.published ? 'Publicar' : 'Despublicar'
    : '';

  return (
    <div className="fixed inset-0 z-[121] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={
          isSuccess
            ? storefrontTest
              ? 'Itens preparados para o teste'
              : publication
                ? 'Publicação do produto atualizada'
                : 'Produto atualizado'
            : storefrontTest
              ? 'Confirmar itens do teste de compra'
              : publication
                ? 'Confirmar publicação do produto'
                : 'Confirmar alteração do produto'
        }
        className="w-full max-w-md overflow-hidden rounded-3xl border border-violet-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            isSuccess
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-violet-500/15 text-violet-300'
          }`}>
            {isSuccess
              ? <CheckCircle2 className="h-6 w-6" />
              : storefrontTest
                ? <ShoppingBag className="h-6 w-6" />
                : publication
                  ? pending.proposal.published
                    ? <Eye className="h-6 w-6" />
                    : <EyeOff className="h-6 w-6" />
                  : <Pencil className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-violet-300">
              Kyrubia
            </span>
            <h2 className="mt-1 text-xl font-black text-white">
              {isSuccess
                ? storefrontTest
                  ? 'Teste preparado'
                  : publication
                    ? 'Publicação atualizada'
                    : 'Produto atualizado'
                : storefrontTest
                  ? 'Confirmar produtos do teste'
                  : publication
                    ? `${publicationVerb} produto`
                    : 'Confirmar alteração do produto'}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={isWorking}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 disabled:opacity-40"
            aria-label="Fechar confirmação"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {isSuccess ? (
            <p className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-sm leading-relaxed text-emerald-100">
              {pending.kind === 'storefront_test'
                ? `Somente “${pending.detail.items[0].name}” e “${pending.detail.items[1].name}” foram publicados para o teste. Os demais rascunhos continuam não publicados.`
                : pending.alreadyApplied
                  ? 'Essa alteração já havia sido aplicada. Nenhuma mudança duplicada foi executada.'
                  : pending.kind === 'product_publication'
                    ? pending.proposal.published
                      ? 'O produto foi publicado pelo lifecycle oficial do Kyrub.'
                      : 'O produto voltou para rascunho e saiu da vitrine pelo lifecycle oficial do Kyrub.'
                    : 'O produto foi atualizado pelo executor oficial do Kyrub e sincronizado no catálogo da sua loja.'}
            </p>
          ) : pending.kind === 'storefront_test' ? (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <span className="text-[11px] font-black uppercase text-slate-500">
                  Somente estes itens irão para a vitrine
                </span>
                <div className="mt-3 space-y-3">
                  {pending.detail.items.map((item, index) => (
                    <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-[10px] font-black uppercase text-violet-300">
                            {index === 0 ? 'Lanche' : 'Sobremesa'}
                          </span>
                          <p className="mt-1 text-sm font-black text-white">{item.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{item.category}</p>
                        </div>
                        <span className="shrink-0 text-sm font-black text-emerald-300">
                          {currency.format(item.price)}
                        </span>
                      </div>
                      {(!item.hasDescription || !item.hasImage) && (
                        <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">
                          {[
                            !item.hasDescription ? 'descrição não informada' : null,
                            !item.hasImage ? 'imagem não informada' : null,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                A confirmação publica somente estes dois produtos. A Kyrubia não inventará ficha técnica, ingredientes, imagens ou descrições ausentes. O servidor ainda revalidará propriedade e limite do plano antes de cada publicação.
              </p>
            </>
          ) : pending.kind === 'product_publication' ? (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <span className="text-[11px] font-black uppercase text-slate-500">Produto</span>
                <p className="mt-1 text-sm font-black text-white">{pending.proposal.productName}</p>
                <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">
                    {pending.proposal.expectedCurrentStatus === 'published' ? 'Publicado' : 'Rascunho'}
                  </div>
                  <span className="text-slate-600">→</span>
                  <div className="rounded-xl border border-violet-500/25 bg-violet-500/10 p-2 text-xs font-black text-violet-200">
                    {pending.proposal.published ? 'Publicado' : 'Rascunho'}
                  </div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                Nada será alterado antes da confirmação. Para publicar, o servidor revalidará os campos obrigatórios e o limite do seu plano. Para despublicar, o produto sai da vitrine mas permanece salvo como rascunho.
              </p>
            </>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <span className="text-[11px] font-black uppercase text-slate-500">Produto identificado</span>
                <p className="mt-1 text-sm font-bold text-slate-200">{pending.proposal.expectedCurrentName}</p>
                <span className="mt-4 block text-[11px] font-black uppercase text-slate-500">Alterações propostas</span>
                <div className="mt-2 space-y-2">
                  {changes.map(change => (
                    <div key={change.field} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                      <span className="text-[10px] font-black uppercase text-violet-300">{change.label}</span>
                      <p className="mt-1 break-words text-sm text-white">{change.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                Somente os campos listados acima serão alterados. Estoque e status de publicação não fazem parte desta ação. O servidor revalidará o produto e a propriedade da loja antes de salvar.
              </p>
            </>
          )}

          {pending.state === 'error' && (
            <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {pending.errorMessage}
            </p>
          )}
        </div>

        <footer className="flex gap-3 border-t border-slate-800 p-4">
          {isSuccess ? (
            <button
              type="button"
              onClick={() => setPending(null)}
              className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950"
            >
              Concluído
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                disabled={isWorking}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-black text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={isWorking}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                {isWorking ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    {storefrontTest ? 'Preparando...' : 'Salvando...'}
                  </>
                ) : storefrontTest
                  ? 'Confirmar 2 itens'
                  : publication
                    ? publicationVerb
                    : 'Confirmar'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
