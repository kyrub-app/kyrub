import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CheckCircle2, LoaderCircle, PackagePlus, X } from 'lucide-react';
import type { KyrubAiImportCatalogDraftProposal } from '../../shared/kyrubActions';
import { executeKyrubAction } from '../actions/kyrubActionService';
import { KYRUB_CATALOG_PRODUCT_CHANGED_EVENT } from '../actions/kyrubCatalogDraftService';
import { auth } from '../utils/firebase';

const ACTION_EVENT = 'kyrub-ai-action-proposal';
const GLOBAL_FLAG = '__kyrubCatalogImportConfirmationBridgeV1';

type ImportEventDetail = {
  conversationId: string;
  requestId: string;
  proposal: KyrubAiImportCatalogDraftProposal;
};

type ImportDialogProps = {
  detail: ImportEventDetail;
  onClose: () => void;
};

type State = 'reviewing' | 'executing' | 'success' | 'error';

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const CatalogImportDialog = ({ detail, onClose }: ImportDialogProps) => {
  const [state, setState] = useState<State>('reviewing');
  const [errorMessage, setErrorMessage] = useState('');
  const [alreadyApplied, setAlreadyApplied] = useState(false);
  const proposal = detail.proposal;
  const visibleItems = proposal.items.slice(0, 12);
  const remainder = proposal.items.length - visibleItems.length;
  const busy = state === 'executing';
  const success = state === 'success';

  const confirm = async (): Promise<void> => {
    if (busy) return;
    const user = auth.currentUser;
    if (!user) {
      setState('error');
      setErrorMessage('Faça login novamente antes de confirmar o cadastro.');
      return;
    }

    setState('executing');
    setErrorMessage('');
    try {
      const result = await executeKyrubAction(user, proposal, true);
      setAlreadyApplied(result.status === 'already_applied');
      setState('success');
      window.dispatchEvent(new CustomEvent(KYRUB_CATALOG_PRODUCT_CHANGED_EVENT, {
        detail: {
          source: 'kyrubia_catalog_import',
          productCount: proposal.items.length,
        },
      }));
    } catch (error) {
      setState('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível cadastrar os produtos analisados.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[126] flex items-start justify-center overflow-y-auto bg-slate-950/90 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={success ? 'Produtos adicionados' : 'Confirmar produtos do cardápio'}
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-violet-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            success
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-violet-500/15 text-violet-300'
          }`}>
            {success
              ? <CheckCircle2 className="h-6 w-6" />
              : <PackagePlus className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-violet-300">
              Kyrubia
            </span>
            <h2 className="mt-1 text-xl font-black text-white">
              {success ? 'Produtos adicionados' : 'Confirmar produtos do cardápio'}
            </h2>
            {!success && (
              <p className="mt-1 text-xs text-slate-500">
                {proposal.items.length} item(ns) serão adicionados como não publicados.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 disabled:opacity-40"
            aria-label="Fechar confirmação"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {success ? (
            <p className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-sm leading-relaxed text-emerald-100">
              {alreadyApplied
                ? 'Este lote já havia sido cadastrado. Nenhuma duplicata foi criada.'
                : `${proposal.items.length} produto(s) foram adicionados a Produtos e serviços como não publicados. Nada foi publicado na vitrine.`}
            </p>
          ) : (
            <>
              <div className="max-h-[52vh] space-y-2 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-3">
                {visibleItems.map((item, index) => (
                  <div
                    key={`${item.ref}-${index}`}
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm text-white">
                          {item.product.name}
                        </strong>
                        <span className="mt-1 block truncate text-[11px] text-slate-500">
                          {item.product.category}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs font-black text-emerald-300">
                        {currency.format(item.product.price ?? 0)}
                      </span>
                    </div>
                  </div>
                ))}
                {remainder > 0 && (
                  <p className="px-2 py-1 text-center text-xs text-slate-500">
                    + {remainder} item(ns) neste mesmo lote
                  </p>
                )}
              </div>

              <p className="text-xs leading-relaxed text-slate-500">
                Nada será cadastrado antes da confirmação. Os itens serão produtos reais da sua loja, inicialmente não publicados; depois você poderá revisar e marcar “Publicado” individualmente.
              </p>

              {state === 'error' && (
                <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {errorMessage}
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex gap-3 border-t border-slate-800 p-4">
          {success ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950"
            >
              Concluído
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-black text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Cadastrando...
                  </>
                ) : 'Confirmar'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
};

const isImportDetail = (value: unknown): value is ImportEventDetail => {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Record<string, unknown>;
  const proposal = detail.proposal;
  return Boolean(
    typeof detail.conversationId === 'string' &&
    proposal &&
    typeof proposal === 'object' &&
    !Array.isArray(proposal) &&
    (proposal as Record<string, unknown>).type === 'import_catalog_draft'
  );
};

const installCatalogImportConfirmationBridge = (): void => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const scopedWindow = window as unknown as Record<string, unknown>;
  if (scopedWindow[GLOBAL_FLAG] === true) return;
  scopedWindow[GLOBAL_FLAG] = true;

  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  const close = (): void => {
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
  };

  window.addEventListener(ACTION_EVENT, event => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isImportDetail(detail)) return;
    close();
    host = document.createElement('div');
    host.id = 'kyrub-catalog-import-confirmation-host';
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<CatalogImportDialog detail={detail} onClose={close} />);
  });
};

installCatalogImportConfirmationBridge();
