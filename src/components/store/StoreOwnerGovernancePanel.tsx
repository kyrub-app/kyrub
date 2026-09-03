import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, ShieldAlert, UserRoundX, UsersRound } from 'lucide-react';
import {
  confirmStoreOwnerGovernanceDecision,
  loadStoreOwnerGovernancePreview,
  type StoreOwnerGovernanceCandidate,
  type StoreOwnerGovernancePreview,
} from '../../utils/storeOwnerGovernance';

export default function StoreOwnerGovernancePanel({
  user,
  storeId,
  onApplied,
}: {
  user: User;
  storeId: string;
  onApplied: () => void;
}) {
  const [preview, setPreview] = useState<StoreOwnerGovernancePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [armedSelectionId, setArmedSelectionId] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const armedCandidate = useMemo(
    () => preview?.candidates.find(candidate => candidate.selectionId === armedSelectionId) ?? null,
    [armedSelectionId, preview]
  );

  const load = async (): Promise<void> => {
    setLoading(true);
    setErrorMessage('');
    try {
      const next = await loadStoreOwnerGovernancePreview(user, storeId);
      setPreview(next);
      setArmedSelectionId('');
    } catch (error) {
      setPreview(null);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível revisar a governança de owners.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [storeId, user.uid]);

  const confirmCandidate = async (candidate: StoreOwnerGovernanceCandidate): Promise<void> => {
    if (!preview || candidate.selectionId !== armedSelectionId) return;
    setApplying(true);
    setErrorMessage('');
    setMessage('');
    try {
      await confirmStoreOwnerGovernanceDecision(user, storeId, preview, candidate);
      setMessage(
        'A autoridade deste owner adicional foi desativada com confirmação explícita. O Kyrub reconsultará a autoridade antes de qualquer próxima decisão.'
      );
      onApplied();
      await load();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível aplicar a decisão de ownership.'
      );
    } finally {
      setApplying(false);
    }
  };

  if (!loading && preview?.state === 'no_conflict' && !message && !errorMessage) return null;
  if (!loading && !preview && !errorMessage) return null;

  const blockedScope = preview?.state === 'authority_scope_mismatch';
  const canonicalOwnerMissing = preview?.state === 'canonical_owner_not_active';
  const multipleOwners = preview?.state === 'multiple_active_owners';

  return (
    <section
      id="kyrub-store-owner-governance"
      className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.045] p-5"
      aria-label="Governança de owners da loja"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-2 text-amber-300">
          <UsersRound className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-300">
            Governança humana · ownership
          </span>
          <h4 className="mt-1 text-sm font-black text-white">Conflito de owners ativos</h4>
          <p className="mt-2 max-w-3xl text-[10px] leading-relaxed text-slate-400">
            Esta área só resolve duplicidade de autoridade quando o owner canônico da loja continua ativo e protegido. Nenhum owner é escolhido automaticamente.
          </p>
        </div>
      </div>

      {loading && (
        <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/55 p-3 text-[10px] text-slate-500">
          Revisando o conjunto atual de owners…
        </p>
      )}

      {blockedScope && (
        <p className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/5 p-3 text-[10px] leading-relaxed text-red-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          A loja privada, o tenant e a loja canônica não estão alinhados o suficiente para uma decisão segura. Nenhuma membership pode ser alterada por esta tela.
        </p>
      )}

      {canonicalOwnerMissing && (
        <p className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/5 p-3 text-[10px] leading-relaxed text-red-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Existem múltiplos owners ativos, mas o owner definido pela loja canônica não está entre eles. O Kyrub não desativará ninguém até essa autoridade ser reconciliada por outro fluxo explícito.
        </p>
      )}

      {multipleOwners && preview && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[10px] leading-relaxed text-emerald-100">
            <strong className="block text-emerald-200">Owner canônico protegido</strong>
            O owner definido pela loja canônica está ativo e não aparece como opção de remoção. Existem {preview.activeOwnerCount} owners ativos neste conflito.
          </div>

          <div className="space-y-2">
            {preview.candidates.map((candidate, index) => {
              const armed = candidate.selectionId && armedSelectionId === candidate.selectionId;
              return (
                <article
                  key={candidate.selectionId || `unidentified-owner-${index}`}
                  className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <span className="text-[8px] font-black uppercase text-amber-300">Owner adicional</span>
                      <strong className="mt-1 block truncate text-xs text-white">{candidate.displayName}</strong>
                      {candidate.emailHint && (
                        <span className="mt-1 block text-[9px] text-slate-500">{candidate.emailHint}</span>
                      )}
                      {!candidate.selectable && (
                        <p className="mt-2 text-[9px] leading-relaxed text-amber-200">
                          Este registro não possui identificação suficiente para uma confirmação humana segura e permanece bloqueado.
                        </p>
                      )}
                    </div>
                    {candidate.selectable && !armed && (
                      <button
                        type="button"
                        onClick={() => {
                          setArmedSelectionId(candidate.selectionId);
                          setMessage('');
                          setErrorMessage('');
                        }}
                        disabled={applying}
                        className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 text-[8px] font-black uppercase text-amber-200 disabled:opacity-40"
                      >
                        <UserRoundX className="h-3.5 w-3.5" /> Revisar remoção da autoridade
                      </button>
                    )}
                  </div>

                  {armed && (
                    <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[0.045] p-3">
                      <p className="flex items-start gap-2 text-[9px] leading-relaxed text-red-100">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Esta decisão marcará somente esta membership de <strong>owner</strong> como <strong>inactive</strong>. Ela não transforma a pessoa em manager e pode remover acessos que dependam desta membership. Estoque, pedidos, canais e outros owners não serão alterados.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => void confirmCandidate(candidate)}
                          disabled={applying}
                          className="inline-flex min-h-9 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 px-3 text-[8px] font-black uppercase text-red-100 disabled:opacity-40"
                        >
                          {applying ? 'Aplicando decisão…' : 'Confirmar desativação deste owner adicional'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setArmedSelectionId('')}
                          disabled={applying}
                          className="inline-flex min-h-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-400 disabled:opacity-40"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      {message && (
        <p className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[10px] leading-relaxed text-emerald-100" role="status">
          {message}
        </p>
      )}

      {errorMessage && (
        <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-3 text-[10px] leading-relaxed text-red-100" role="alert">
          {errorMessage}
        </p>
      )}

      <p className="mt-4 text-[9px] leading-relaxed text-slate-600">
        A decisão de ownership não altera saldo físico, bindings, reservas, pedidos ou estado em provedores externos. Cada owner adicional exige uma confirmação separada e o conflito é recalculado depois de cada decisão.
      </p>
    </section>
  );
}
