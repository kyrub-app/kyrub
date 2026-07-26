import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  AlertTriangle,
  Archive,
  PackageX,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { Store } from '../../types';
import {
  STORE_RESET_CONFIRMATION_TEXT,
  hasMeaningfulStoreSetup,
} from '../../utils/storeReset';

interface StoreResetDangerZoneProps {
  store: Store | null;
  isResetting: boolean;
  onReset: () => Promise<void>;
}

const normalizeConfirmation = (value: string): string =>
  value.trim().toLocaleUpperCase('pt-BR');

export const StoreResetDangerZone: React.FC<StoreResetDangerZoneProps> = ({
  store,
  isResetting,
  onReset,
}) => {
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const [confirmationValue, setConfirmationValue] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const hasStoreSetup = hasMeaningfulStoreSetup(store);
  const expectedConfirmation = useMemo(
    () => store?.name.trim() || STORE_RESET_CONFIRMATION_TEXT,
    [store?.name]
  );
  const confirmationMatches =
    normalizeConfirmation(confirmationValue) ===
    normalizeConfirmation(expectedConfirmation);
  const canConfirm =
    hasStoreSetup && confirmationMatches && acknowledged && !isResetting;

  useEffect(() => {
    if (isConfirmationOpen) return;
    setConfirmationValue('');
    setAcknowledged(false);
    setErrorMessage('');
  }, [isConfirmationOpen]);

  const handleConfirm = async (): Promise<void> => {
    if (!canConfirm) return;
    setErrorMessage('');

    try {
      await onReset();
      setIsConfirmationOpen(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível excluir a configuração da loja.'
      );
    }
  };

  return (
    <>
      <section
        className="space-y-3 rounded-2xl border border-red-500/25 bg-red-500/[0.055] p-4"
        id="store-reset-danger-zone"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-300">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-red-300">
              Zona de perigo
            </span>
            <h4 className="mt-1 text-sm font-black text-white">
              Excluir loja e recomeçar
            </h4>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              Remove a configuração da vitrine e arquiva o catálogo para que esta conta volte à etapa “Criar loja”.
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-start gap-2 rounded-xl border border-red-500/15 bg-slate-950/60 p-3">
            <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <div>
              <strong className="block text-[9px] uppercase text-slate-200">
                Será reiniciado
              </strong>
              <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">
                Perfil, slug, imagens, endereço público, palavras-chave, ambientes e produtos/serviços.
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/15 bg-slate-950/60 p-3">
            <Archive className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <div>
              <strong className="block text-[9px] uppercase text-slate-200">
                Será preservado
              </strong>
              <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">
                Pedidos, pagamentos, caixa, colaboradores e registros de auditoria.
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsConfirmationOpen(true)}
          disabled={!hasStoreSetup || isResetting}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-500/35 bg-red-500/10 px-4 text-[10px] font-black uppercase tracking-wide text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          id="delete-store-and-restart-button"
        >
          <Trash2 className="h-4 w-4" />
          {isResetting ? 'Reiniciando...' : 'Excluir loja'}
        </button>

        {!hasStoreSetup && (
          <p className="text-center text-[9px] text-slate-600">
            A loja já está vazia e pronta para uma nova configuração.
          </p>
        )}
      </section>

      {isConfirmationOpen && (
        <div
          className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/90 p-0 backdrop-blur-md sm:items-center sm:p-5"
          role="presentation"
          onClick={() => !isResetting && setIsConfirmationOpen(false)}
          id="store-reset-confirmation-overlay"
        >
          <section
            className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-red-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-reset-confirmation-title"
            onClick={event => event.stopPropagation()}
            id="store-reset-confirmation-dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/10 text-red-300">
                  <RotateCcw className="h-5 w-5" />
                </span>
                <div>
                  <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-red-300">
                    Confirmação obrigatória
                  </span>
                  <h3
                    id="store-reset-confirmation-title"
                    className="mt-1 text-xl font-black text-white"
                  >
                    Excluir esta loja e recomeçar?
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmationOpen(false)}
                disabled={isResetting}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 hover:text-white disabled:opacity-40"
                aria-label="Fechar confirmação"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.07] p-4 text-[11px] leading-relaxed text-red-100">
                A vitrine será ocultada imediatamente e o catálogo será arquivado. O Kyrub mantém o histórico operacional para segurança, conciliação e auditoria.
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="store-reset-confirmation-input"
                  className="block text-[10px] font-black uppercase text-slate-300"
                >
                  Digite <span className="text-red-300">{expectedConfirmation}</span> para confirmar
                </label>
                <input
                  id="store-reset-confirmation-input"
                  type="text"
                  value={confirmationValue}
                  onChange={event => setConfirmationValue(event.target.value)}
                  autoComplete="off"
                  disabled={isResetting}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-400 disabled:opacity-50"
                  placeholder={expectedConfirmation}
                />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={event => setAcknowledged(event.target.checked)}
                  disabled={isResetting}
                  className="mt-0.5 h-4 w-4 accent-red-500"
                  id="store-reset-history-acknowledgement"
                />
                <span className="text-[10px] leading-relaxed text-slate-400">
                  Entendi que o perfil e o catálogo serão reiniciados, mas pedidos, valores, equipe e auditoria permanecerão preservados.
                </span>
              </label>

              <div className="flex items-start gap-2 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.055] p-3 text-[9px] leading-relaxed text-emerald-200">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                Depois da conclusão, a conta voltará a mostrar “Criar loja” e poderá cadastrar um novo perfil do zero.
              </div>

              {errorMessage && (
                <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] font-bold text-red-200">
                  {errorMessage}
                </p>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsConfirmationOpen(false)}
                disabled={isResetting}
                className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[10px] font-black uppercase text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={!canConfirm}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 text-[10px] font-black uppercase text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-35"
                id="confirm-delete-store-and-restart-button"
              >
                <Trash2 className="h-4 w-4" />
                {isResetting ? 'Excluindo...' : 'Excluir e recomeçar'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
};
