import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  BadgeCheck,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import {
  designateOfficialStore,
  loadOfficialStoreIdentity,
  type OfficialStoreIdentity,
} from '../../utils/officialStore';

interface Props {
  authenticatedUser: User;
  storeId: string;
  onIdentityChange?: (identity: OfficialStoreIdentity | null) => void;
}

type AsyncState = {
  loading: boolean;
  busy: boolean;
  error: string;
  success: string;
};

const initialState: AsyncState = {
  loading: true,
  busy: false,
  error: '',
  success: '',
};

const storeLabel = (identity: OfficialStoreIdentity): string =>
  identity.storeName || identity.canonicalStoreId;

export default function OfficialStoreIdentityPanel({
  authenticatedUser,
  storeId,
  onIdentityChange,
}: Props) {
  const [identity, setIdentity] = useState<OfficialStoreIdentity | null>(null);
  const [state, setState] = useState<AsyncState>(initialState);

  const commitIdentity = useCallback((next: OfficialStoreIdentity | null) => {
    setIdentity(next);
    onIdentityChange?.(next);
  }, [onIdentityChange]);

  const load = useCallback(async () => {
    commitIdentity(null);
    setState(current => ({
      ...current,
      loading: true,
      error: '',
    }));
    try {
      const snapshot = await loadOfficialStoreIdentity(authenticatedUser);
      commitIdentity(snapshot.identity);
      setState(current => ({ ...current, loading: false }));
    } catch (error) {
      commitIdentity(null);
      setState(current => ({
        ...current,
        loading: false,
        error: error instanceof Error
          ? error.message
          : 'Não foi possível carregar a Loja Oficial Cairobi.',
      }));
    }
  }, [authenticatedUser, commitIdentity]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentStoreIsOfficial = useMemo(
    () => Boolean(
      identity &&
      (identity.canonicalStoreId === storeId || identity.legacyStoreId === storeId)
    ),
    [identity, storeId]
  );

  const designate = async () => {
    if (state.busy || currentStoreIsOfficial) return;
    const replacing = Boolean(identity);
    if (replacing) {
      const confirmed = window.confirm(
        `A Loja Oficial atual é “${storeLabel(identity as OfficialStoreIdentity)}”. Substituir pela loja que está aberta agora? A troca ficará registrada na auditoria.`
      );
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(
        'Designar a loja que está aberta agora como Loja Oficial Cairobi? Esta identidade é separada da cortesia e ficará registrada na auditoria.'
      );
      if (!confirmed) return;
    }

    setState(current => ({
      ...current,
      busy: true,
      error: '',
      success: '',
    }));
    try {
      const result = await designateOfficialStore(
        authenticatedUser,
        storeId,
        replacing
      );
      commitIdentity(result.identity);
      setState(current => ({
        ...current,
        busy: false,
        success: result.changed
          ? 'Loja Oficial Cairobi atualizada com sucesso.'
          : 'Esta loja já era a Loja Oficial Cairobi.',
      }));
    } catch (error) {
      setState(current => ({
        ...current,
        busy: false,
        error: error instanceof Error
          ? error.message
          : 'Não foi possível atualizar a Loja Oficial Cairobi.',
      }));
    }
  };

  return (
    <section
      data-kyrub-official-store-identity="canonical"
      className="rounded-3xl border border-cyan-500/25 bg-slate-900 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-2.5 text-cyan-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-cyan-400">
              Identidade da plataforma
            </span>
            <h4 className="mt-1 text-sm font-black text-white">
              Loja Oficial Cairobi
            </h4>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
              A identidade oficial aponta para uma única loja canônica. Ela não é inferida por cortesia, nome, slug ou e-mail.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.loading || state.busy}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-400 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${state.loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {state.loading ? (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-[10px] text-slate-400">
          <LoaderCircle className="h-4 w-4 animate-spin text-cyan-300" />
          Consultando a identidade oficial…
        </div>
      ) : currentStoreIsOfficial && identity ? (
        <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-emerald-300">
            <BadgeCheck className="h-4 w-4" />
            <strong className="text-[10px] font-black uppercase tracking-wider">
              Esta é a Loja Oficial Cairobi
            </strong>
          </div>
          <p className="mt-2 text-xs font-bold text-white">{storeLabel(identity)}</p>
          <p className="mt-1 font-mono text-[9px] text-slate-500">
            canonical: {identity.canonicalStoreId}
          </p>
          <p className="mt-1 text-[9px] text-slate-500">
            Designada em {identity.designatedAt
              ? new Date(identity.designatedAt).toLocaleString('pt-BR')
              : 'data não disponível'}.
          </p>
        </div>
      ) : identity ? (
        <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-amber-200">
            <TriangleAlert className="h-4 w-4" />
            <strong className="text-[10px] font-black uppercase tracking-wider">
              Outra loja está designada
            </strong>
          </div>
          <p className="mt-2 text-xs font-bold text-white">{storeLabel(identity)}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            Só substitua a identidade se a loja aberta agora realmente deve assumir o papel oficial da plataforma.
          </p>
          <button
            type="button"
            onClick={() => void designate()}
            disabled={state.busy}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 text-[9px] font-black uppercase text-amber-100 disabled:opacity-40"
          >
            {state.busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            Substituir pela loja atual
          </button>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950 p-4">
          <p className="text-[10px] leading-relaxed text-slate-400">
            Nenhuma Loja Oficial Cairobi foi designada ainda. A loja aberta agora pode ser promovida sem alterar sua cortesia ou seu histórico operacional.
          </p>
          <button
            type="button"
            onClick={() => void designate()}
            disabled={state.busy}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-400 px-4 text-[9px] font-black uppercase text-slate-950 disabled:opacity-40"
          >
            {state.busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            Designar esta loja como oficial
          </button>
        </div>
      )}

      {state.error && (
        <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] text-red-200">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[10px] text-emerald-200">
          {state.success}
        </div>
      )}
    </section>
  );
}
