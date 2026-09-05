import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LoaderCircle, Network, ShieldCheck, X } from 'lucide-react';
import type { KyrubCommerceChannel } from '../../shared/storeConnections.js';
import { storeConnectionChannelLabel } from '../ai/deterministicStoreConnectionOnboarding';
import {
  KYRUB_STORE_CONNECTION_ONBOARDING_PROPOSAL_EVENT,
  type KyrubStoreConnectionOnboardingProposalEventDetail,
} from '../ai/storeConnectionOnboardingEvents';
import { saveStoreCommerceChannelDeclaration } from '../utils/storeConnectionOnboarding';
import { loadStoreConnectionOnboarding } from '../utils/storeConnections';
import { auth } from '../utils/firebase';

type ConfirmationState = 'reviewing' | 'executing' | 'success' | 'error';

type PendingDeclaration = {
  conversationId: string;
  answer: string;
  channels: KyrubCommerceChannel[];
  state: ConfirmationState;
  errorMessage: string;
  connectedChannels: KyrubCommerceChannel[];
};

const INTEGRATION_READY_CHANNELS = new Set<KyrubCommerceChannel>([
  'mercado_livre',
  '99food',
]);

export function KyrubAiStoreConnectionOnboardingBridge() {
  const [pending, setPending] = useState<PendingDeclaration | null>(null);

  useEffect(() => {
    const handleProposal = (event: Event) => {
      const detail = (event as CustomEvent<KyrubStoreConnectionOnboardingProposalEventDetail>).detail;
      if (!detail) return;
      setPending({
        conversationId: detail.conversationId,
        answer: detail.answer,
        channels: detail.channels,
        state: 'reviewing',
        errorMessage: '',
        connectedChannels: [],
      });
    };
    window.addEventListener(KYRUB_STORE_CONNECTION_ONBOARDING_PROPOSAL_EVENT, handleProposal);
    return () => window.removeEventListener(KYRUB_STORE_CONNECTION_ONBOARDING_PROPOSAL_EVENT, handleProposal);
  }, []);

  const channelRows = useMemo(() => pending?.channels.map(channel => ({
    channel,
    label: storeConnectionChannelLabel(channel),
    integrationAvailable: INTEGRATION_READY_CHANNELS.has(channel),
    connected: pending.connectedChannels.includes(channel),
  })) ?? [], [pending]);

  if (!pending) return null;

  const working = pending.state === 'executing';
  const success = pending.state === 'success';

  const close = () => {
    if (!working) setPending(null);
  };

  const confirm = async () => {
    if (working) return;
    const user = auth.currentUser;
    if (!user) {
      setPending(value => value ? {
        ...value,
        state: 'error',
        errorMessage: 'Faça login novamente antes de registrar os canais da loja.',
      } : value);
      return;
    }

    const current = pending;
    setPending(value => value ? { ...value, state: 'executing', errorMessage: '' } : value);
    try {
      await saveStoreCommerceChannelDeclaration(user, user.uid, current.channels);
      const snapshot = await loadStoreConnectionOnboarding(user, user.uid);
      const connectedChannels = snapshot.connections
        .filter(connection => connection.status === 'connected')
        .map(connection => connection.channel);
      setPending(value => value ? {
        ...value,
        state: 'success',
        errorMessage: '',
        connectedChannels,
      } : value);
    } catch (error) {
      setPending(value => value ? {
        ...value,
        state: 'error',
        errorMessage: error instanceof Error
          ? error.message
          : 'Não foi possível registrar os canais da loja.',
      } : value);
    }
  };

  return (
    <div className="fixed inset-0 z-[127] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={success ? 'Canais da loja registrados' : 'Confirmar canais da loja'}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-cyan-500/25 bg-slate-950 shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${success ? 'bg-emerald-500/15 text-emerald-300' : 'bg-cyan-500/15 text-cyan-300'}`}>
            {success ? <CheckCircle2 className="h-6 w-6" /> : <Network className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-black uppercase tracking-wider text-cyan-300">Kyrubia · Canais</span>
            <h2 className="mt-1 text-xl font-black text-white">
              {success ? 'Canais registrados' : 'Confirmar onde você já vende'}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={working}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 disabled:opacity-40"
            aria-label="Fechar confirmação"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {success ? (
            <>
              <p className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-sm leading-relaxed text-emerald-100">
                {pending.channels.length > 0
                  ? 'A declaração foi salva. Nenhuma conta externa foi conectada e nenhuma sincronização foi iniciada.'
                  : 'Registrado: sua loja não declarou outros canais de venda neste momento.'}
              </p>
              {channelRows.length > 0 && (
                <div className="space-y-2">
                  {channelRows.map(item => (
                    <div key={item.channel} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                      <strong className="text-sm text-slate-200">{item.label}</strong>
                      <span className={`text-[10px] font-black uppercase ${item.connected ? 'text-emerald-300' : item.integrationAvailable ? 'text-cyan-300' : 'text-slate-500'}`}>
                        {item.connected ? 'Conectado' : item.integrationAvailable ? 'Pode conectar' : 'Declarado'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {channelRows.length > 0 ? (
                <div className="space-y-2">
                  {channelRows.map(item => (
                    <div key={item.channel} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                      <strong className="text-sm text-slate-200">{item.label}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-300">
                  Você informou que não vende em outros canais atualmente.
                </p>
              )}

              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                <div className="flex items-center gap-2 text-cyan-300">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="text-xs font-black uppercase tracking-wider">Limite desta confirmação</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                  Isto só registra onde sua loja já vende. Não conecta nenhuma conta, não pede credenciais, não importa catálogo, não altera estoque e não ativa sincronização.
                </p>
              </div>

              {pending.state === 'error' && (
                <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {pending.errorMessage}
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex gap-3 border-t border-slate-800 p-4">
          {success ? (
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
                disabled={working}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-black text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={working}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-60"
              >
                {working ? <><LoaderCircle className="h-4 w-4 animate-spin" />Salvando...</> : 'Confirmar canais'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
