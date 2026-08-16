import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FileText,
  LoaderCircle,
  PackagePlus,
  Store,
  X,
} from 'lucide-react';
import type {
  KyrubAiCreateNoteProposal,
  KyrubAiCreateProductProposal,
  KyrubAiImportCatalogDraftProposal,
  KyrubAiStartStoreActivationProposal,
  KyrubAiUpdateStoreProfileProposal,
} from '../../shared/kyrubActions';
import { executeKyrubAction } from '../actions/kyrubActionService';
import {
  KYRUB_AI_ACTION_PROPOSAL_EVENT,
  type KyrubAiActionProposalEventDetail,
} from '../ai/actionEvents';
import {
  authorizeKyrubiaStoreActivationWorkflow,
  clearKyrubiaOperationalWorkflow,
  getKyrubiaProductSequenceProgress,
  loadKyrubiaOperationalWorkflow,
} from '../ai/operationalWorkflowStore';
import { auth } from '../utils/firebase';

type ConfirmationState =
  | 'reviewing'
  | 'executing'
  | 'success'
  | 'error';

type ConfirmableProposal =
  | KyrubAiCreateNoteProposal
  | KyrubAiStartStoreActivationProposal
  | KyrubAiUpdateStoreProfileProposal
  | KyrubAiImportCatalogDraftProposal
  | KyrubAiCreateProductProposal;

type PendingAction = {
  conversationId: string;
  requestId: string;
  proposal: ConfirmableProposal;
  state: ConfirmationState;
  errorMessage: string;
  alreadyApplied: boolean;
};

const withIdempotency = (
  conversationId: string,
  proposal: ConfirmableProposal
): ConfirmableProposal => ({
  ...proposal,
  origin: proposal.origin ?? 'kyrubia',
  risk: proposal.risk ?? (proposal.type === 'create_product' ? 'medium' : 'low'),
  idempotencyKey:
    proposal.idempotencyKey ??
    `kyrubia:${proposal.type}:${conversationId}:${proposal.id}`,
});

const actionTitle = (
  proposal: ConfirmableProposal,
  success: boolean
): string => {
  if (proposal.type === 'start_store_activation') {
    return success ? 'Ativação autorizada' : 'Ativar sua loja';
  }
  if (proposal.type === 'update_store_profile') {
    return success ? 'Perfil atualizado' : 'Confirmar alteração da loja';
  }
  if (proposal.type === 'import_catalog_draft') {
    return success ? 'Produtos adicionados' : 'Confirmar produtos do cardápio';
  }
  if (proposal.type === 'create_product') {
    return success ? 'Produto criado' : 'Confirmar novo produto';
  }
  return success ? 'Nota criada' : 'Confirmar nova nota';
};

const workingLabel = (proposal: ConfirmableProposal): string => {
  if (proposal.type === 'start_store_activation') return 'Ativando...';
  if (proposal.type === 'update_store_profile') return 'Salvando...';
  if (
    proposal.type === 'create_product' ||
    proposal.type === 'import_catalog_draft'
  ) return 'Cadastrando...';
  return 'Criando...';
};

const confirmLabel = (proposal: ConfirmableProposal): string =>
  proposal.type === 'start_store_activation' ? 'Ativar' : 'Confirmar';

const actionIcon = (
  proposal: ConfirmableProposal,
  success: boolean
) => {
  if (success) return <CheckCircle2 className="h-6 w-6" />;
  if (
    proposal.type === 'start_store_activation' ||
    proposal.type === 'update_store_profile'
  ) {
    return <Store className="h-6 w-6" />;
  }
  if (
    proposal.type === 'create_product' ||
    proposal.type === 'import_catalog_draft'
  ) {
    return <PackagePlus className="h-6 w-6" />;
  }
  return <FileText className="h-6 w-6" />;
};

const nextProductMessage = (pending: PendingAction): string | null => {
  if (
    pending.proposal.type !== 'create_product' ||
    typeof localStorage === 'undefined' ||
    !auth.currentUser
  ) {
    return null;
  }
  const workflow = loadKyrubiaOperationalWorkflow(
    localStorage,
    auth.currentUser.uid,
    pending.conversationId
  );
  if (!workflow || workflow.stage !== 'collecting_product_name') return null;
  const progress = getKyrubiaProductSequenceProgress(workflow);
  if (!progress.hasMore || !progress.nextItemNumber) return null;
  return ` Produto ${progress.completedCount} de ${progress.requestedCount} concluído. Feche esta janela e informe somente o nome do produto ${progress.nextItemNumber} de ${progress.requestedCount} para continuar.`;
};

const successMessage = (pending: PendingAction): string => {
  if (pending.proposal.type === 'start_store_activation') {
    return pending.alreadyApplied
      ? 'A autorização de ativação já estava válida. Feche esta janela e continue informando os dados da loja na conversa.'
      : 'Ativação autorizada. A Kyrubia poderá configurar somente o perfil da sua própria loja durante este fluxo. A loja não foi publicada no marketplace. Feche esta janela e informe o nome da loja na conversa.';
  }
  if (pending.proposal.type === 'update_store_profile') {
    return pending.alreadyApplied
      ? 'Essa alteração do perfil já havia sido aplicada. Nenhuma mudança duplicada foi executada.'
      : 'A alteração foi salva pelo executor oficial do Kyrub no perfil da sua loja.';
  }
  if (pending.proposal.type === 'import_catalog_draft') {
    const count = pending.proposal.items.length;
    return pending.alreadyApplied
      ? `Esses ${count} item(ns) já haviam sido adicionados ao catálogo. Nenhuma duplicata foi criada.`
      : `${count} item(ns) foram adicionados como produtos não publicados. Revise-os em Produtos e serviços e marque “Publicado” somente nos que quiser colocar na vitrine.`;
  }
  if (pending.proposal.type === 'create_product') {
    const continuation = nextProductMessage(pending) ?? '';
    return pending.alreadyApplied
      ? `Este produto já havia sido cadastrado por esta ação. Nenhuma duplicata foi criada.${continuation}`
      : `O produto foi criado pelo executor oficial do Kyrub e será sincronizado no catálogo da sua loja.${continuation}`;
  }
  return pending.alreadyApplied
    ? 'Esta ação já havia sido concluída. Nenhuma nota duplicada foi criada.'
    : 'A nota foi criada pelo serviço oficial do Kyrub e será exibida na guia Notas pela sincronização em nuvem.';
};

const reviewHint = (proposal: ConfirmableProposal): string => {
  if (proposal.type === 'start_store_activation') {
    return 'Esta confirmação autoriza somente a configuração do perfil da sua loja durante o fluxo atual. Não publica a loja no marketplace e não a marca como aberta.';
  }
  if (proposal.type === 'update_store_profile') {
    return 'Nada será alterado antes da confirmação. Somente os campos mostrados acima serão salvos na sua própria loja.';
  }
  if (proposal.type === 'import_catalog_draft') {
    return 'Nada irá automaticamente para a vitrine. A confirmação cria somente produtos não publicados; depois você escolhe quais marcar como “Publicado”.';
  }
  if (proposal.type === 'create_product') {
    return 'Nada será cadastrado antes da confirmação. O produto será criado na sua própria loja e respeitará os limites do seu plano.';
  }
  return 'Nada será salvo antes da confirmação. A nota continuará privada e não será publicada no feed.';
};

const ReviewContent = ({ proposal }: { proposal: ConfirmableProposal }) => {
  if (proposal.type === 'start_store_activation') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <span className="text-[11px] font-black uppercase text-slate-500">
          Escopo da autorização
        </span>
        <h3 className="mt-1 text-lg font-black text-white">
          Configurar o perfil da sua loja
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          A Kyrubia poderá salvar, enquanto você conversa, apenas nome, descrição,
          endereço, contato e palavras-chave da sua própria loja. A autorização é
          temporária e vinculada à sua conta.
        </p>
      </div>
    );
  }

  if (proposal.type === 'update_store_profile') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <span className="text-[11px] font-black uppercase text-slate-500">
          Alteração do perfil
        </span>
        <dl className="mt-3 space-y-3 text-sm">
          {proposal.patch.name !== undefined && (
            <div>
              <dt className="text-[10px] font-black uppercase text-slate-500">Nome da loja</dt>
              <dd className="mt-1 text-slate-200">{proposal.patch.name}</dd>
            </div>
          )}
          {proposal.patch.description !== undefined && (
            <div>
              <dt className="text-[10px] font-black uppercase text-slate-500">Descrição</dt>
              <dd className="mt-1 whitespace-pre-wrap text-slate-200">{proposal.patch.description}</dd>
            </div>
          )}
          {proposal.patch.address !== undefined && (
            <div>
              <dt className="text-[10px] font-black uppercase text-slate-500">Endereço</dt>
              <dd className="mt-1 text-slate-200">{proposal.patch.address}</dd>
            </div>
          )}
          {proposal.patch.contact !== undefined && (
            <div>
              <dt className="text-[10px] font-black uppercase text-slate-500">Contato</dt>
              <dd className="mt-1 text-slate-200">{proposal.patch.contact}</dd>
            </div>
          )}
          {proposal.patch.keywords !== undefined && (
            <div>
              <dt className="text-[10px] font-black uppercase text-slate-500">Palavras-chave</dt>
              <dd className="mt-1 text-slate-200">{proposal.patch.keywords.join(', ')}</dd>
            </div>
          )}
        </dl>
      </div>
    );
  }

  if (proposal.type === 'import_catalog_draft') {
    const visibleItems = proposal.items.slice(0, 20);
    const remaining = proposal.items.length - visibleItems.length;
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <span className="text-[11px] font-black uppercase text-slate-500">
          Produtos não publicados
        </span>
        <h3 className="mt-1 text-lg font-black text-white">
          {proposal.items.length} item(ns) para adicionar
        </h3>
        <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
          {visibleItems.map(item => (
            <div
              key={`${proposal.id}-${item.ref}`}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <strong className="text-sm text-slate-100">
                  {item.product.name}
                </strong>
                <span className="shrink-0 text-xs font-black text-emerald-300">
                  {(item.product.price ?? 0).toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {item.product.category}
                {item.product.isService
                  ? ' · Serviço'
                  : item.product.stock !== undefined
                    ? ` · Estoque ${item.product.stock}`
                    : ' · Estoque não informado'}
              </p>
            </div>
          ))}
        </div>
        {remaining > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            + {remaining} item(ns) na mesma importação.
          </p>
        )}
      </div>
    );
  }

  if (proposal.type === 'create_product') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <span className="text-[11px] font-black uppercase text-slate-500">
          {proposal.isService ? 'Serviço' : 'Produto'}
        </span>
        <h3 className="mt-1 text-lg font-black text-white">
          {proposal.name}
        </h3>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[10px] font-black uppercase text-slate-500">Preço</dt>
            <dd className="mt-1 text-slate-200">
              {proposal.isComplimentary
                ? 'Grátis'
                : proposal.price.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-black uppercase text-slate-500">Categoria</dt>
            <dd className="mt-1 text-slate-200">{proposal.category}</dd>
          </div>
          {!proposal.isService && (
            <div>
              <dt className="text-[10px] font-black uppercase text-slate-500">Estoque</dt>
              <dd className="mt-1 text-slate-200">{proposal.stock} unidades</dd>
            </div>
          )}
          <div>
            <dt className="text-[10px] font-black uppercase text-slate-500">Imagem</dt>
            <dd className="mt-1 text-slate-200">
              {proposal.image ? 'Informada' : 'Sem imagem'}
            </dd>
          </div>
        </dl>
        {proposal.description && (
          <>
            <span className="mt-4 block text-[11px] font-black uppercase text-slate-500">
              Descrição
            </span>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
              {proposal.description}
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <span className="text-[11px] font-black uppercase text-slate-500">
        Título
      </span>
      <h3 className="mt-1 text-lg font-black text-white">
        {proposal.title}
      </h3>
      <span className="mt-4 block text-[11px] font-black uppercase text-slate-500">
        Conteúdo
      </span>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
        {proposal.content}
      </p>
      {proposal.checklist.length > 0 && (
        <div className="mt-4">
          <span className="text-[11px] font-black uppercase text-slate-500">
            Checklist
          </span>
          <div className="mt-2 space-y-2">
            {proposal.checklist.map((item, index) => (
              <div
                key={`${proposal.id}-${index}`}
                className="flex gap-2 text-sm text-slate-300"
              >
                <span className="text-violet-300">☐</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export function KyrubAiNoteActionBridge() {
  const [pending, setPending] = useState<PendingAction | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubAiActionProposalEventDetail>).detail;
      if (!detail) return;
      if (
        detail.proposal.type !== 'create_note' &&
        detail.proposal.type !== 'start_store_activation' &&
        detail.proposal.type !== 'update_store_profile' &&
        detail.proposal.type !== 'import_catalog_draft' &&
        detail.proposal.type !== 'create_product'
      ) {
        return;
      }

      setPending({
        conversationId: detail.conversationId,
        requestId: detail.requestId,
        proposal: withIdempotency(detail.conversationId, detail.proposal),
        state: 'reviewing',
        errorMessage: '',
        alreadyApplied: false,
      });
    };

    window.addEventListener(KYRUB_AI_ACTION_PROPOSAL_EVENT, handleProposal);
    return () =>
      window.removeEventListener(KYRUB_AI_ACTION_PROPOSAL_EVENT, handleProposal);
  }, []);

  if (!pending) return null;

  const close = () => {
    if (pending.state === 'executing') return;
    if (
      pending.state !== 'success' &&
      (pending.proposal.type === 'start_store_activation' ||
        pending.proposal.type === 'create_product') &&
      auth.currentUser &&
      typeof localStorage !== 'undefined'
    ) {
      clearKyrubiaOperationalWorkflow(
        localStorage,
        auth.currentUser.uid,
        pending.conversationId
      );
    }
    setPending(null);
  };

  const confirm = async () => {
    if (pending.state === 'executing') return;

    setPending(current => current ? {
      ...current,
      state: 'executing',
      errorMessage: '',
    } : current);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Faça login novamente antes de confirmar esta ação.');
      }

      const result = await executeKyrubAction(user, pending.proposal, true);

      if (pending.proposal.type === 'start_store_activation') {
        if (!result.authorizationGrant || typeof localStorage === 'undefined') {
          throw new Error(
            'A ativação foi processada sem uma autorização de continuidade válida. Tente novamente.'
          );
        }
        const workflow = authorizeKyrubiaStoreActivationWorkflow(
          localStorage,
          user.uid,
          pending.conversationId,
          result.authorizationGrant
        );
        if (!workflow) {
          throw new Error(
            'O objetivo da conversa não pôde ser retomado. Faça o pedido novamente.'
          );
        }
      }

      if (
        pending.proposal.type === 'create_product' &&
        typeof localStorage !== 'undefined'
      ) {
        clearKyrubiaOperationalWorkflow(
          localStorage,
          user.uid,
          pending.conversationId
        );
      }

      setPending(current => current ? {
        ...current,
        state: 'success',
        errorMessage: '',
        alreadyApplied: result.status === 'already_applied',
      } : current);
    } catch (error) {
      setPending(current => current ? {
        ...current,
        state: 'error',
        errorMessage: error instanceof Error
          ? error.message
          : 'Não foi possível executar esta ação.',
      } : current);
    }
  };

  const isWorking = pending.state === 'executing';
  const isSuccess = pending.state === 'success';

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={actionTitle(pending.proposal, isSuccess)}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-violet-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            isSuccess
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-violet-500/15 text-violet-300'
          }`}>
            {actionIcon(pending.proposal, isSuccess)}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-violet-300">
              Kyrubia
            </span>
            <h2 className="mt-1 text-xl font-black text-white">
              {actionTitle(pending.proposal, isSuccess)}
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
              {successMessage(pending)}
            </p>
          ) : (
            <>
              <ReviewContent proposal={pending.proposal} />
              <p className="text-xs leading-relaxed text-slate-500">
                {reviewHint(pending.proposal)}
              </p>

              {pending.state === 'error' && (
                <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {pending.errorMessage}
                </p>
              )}
            </>
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
                    {workingLabel(pending.proposal)}
                  </>
                ) : (
                  confirmLabel(pending.proposal)
                )}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
