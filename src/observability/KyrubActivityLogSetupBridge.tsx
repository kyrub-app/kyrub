import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Activity, ShieldCheck, Trash2, X } from 'lucide-react';
import type { KyrubActivityEvent } from '../../shared/kyrubActivityEvents';
import { auth } from '../utils/firebase';
import {
  clearCurrentUserActivityEvents,
  KYRUB_ACTIVITY_UPDATED_EVENT,
  readCurrentUserActivityEvents,
} from './kyrubActivityBrowser';

const ACTIVITY_QUERY_KEY = 'activityLogSetup';

const isActivitySetupEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(ACTIVITY_QUERY_KEY) === '1';
};

const eventTitle = (event: KyrubActivityEvent): string => {
  if (event.type === 'navigation.screen_viewed') return 'Tela observada';
  if (event.type === 'navigation.community_opened') return 'Comunidade aberta';
  if (event.type === 'interaction.action_attempted') return 'Ação tentada';
  if (event.type === 'result.action_succeeded') return 'Resultado confirmado';
  return 'Falha observada';
};

const formatTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(date);
};

export function KyrubActivityLogSetupBridge() {
  const enabled = isActivitySetupEnabled();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [events, setEvents] = useState<KyrubActivityEvent[]>([]);

  const refresh = useCallback(() => {
    setEvents(readCurrentUserActivityEvents(80));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    return onAuthStateChanged(auth, currentUser => {
      setUser(currentUser);
      window.setTimeout(refresh, 0);
    });
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const handleUpdate = () => refresh();
    const handleStorage = (event: StorageEvent) => {
      if (event.key?.startsWith('kyrub_activity_events_v1_')) refresh();
    };
    window.addEventListener(KYRUB_ACTIVITY_UPDATED_EVENT, handleUpdate);
    window.addEventListener('storage', handleStorage);
    refresh();
    return () => {
      window.removeEventListener(KYRUB_ACTIVITY_UPDATED_EVENT, handleUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, [enabled, refresh]);

  if (!enabled) return null;

  const closeSetup = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete(ACTIVITY_QUERY_KEY);
    window.location.href = url.toString();
  };

  const clearTimeline = () => {
    clearCurrentUserActivityEvents();
    refresh();
  };

  return (
    <div className="fixed inset-0 z-[280] overflow-y-auto bg-slate-950/95 p-3 backdrop-blur-md sm:p-6">
      <section className="mx-auto w-full max-w-2xl rounded-3xl border border-cyan-500/25 bg-slate-900 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
          <div>
            <span className="text-[8px] font-black uppercase tracking-[0.18em] text-cyan-300">
              Diagnóstico · Observabilidade semântica
            </span>
            <h1 className="mt-1 text-lg font-black text-white">
              Linha do tempo operacional
            </h1>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              Estes eventos ficam somente neste navegador nesta fase. Eles descrevem telas e ações por identificadores estruturados; não armazenam o texto de conversas, posts, emails, telefones ou endereços.
            </p>
          </div>
          <button
            type="button"
            onClick={closeSetup}
            aria-label="Fechar diagnóstico"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              <div>
                <strong className="text-[9px] uppercase text-emerald-300">
                  Autoridade separada de observação
                </strong>
                <p className="mt-1 text-[9px] leading-relaxed text-slate-400">
                  Eventos de navegação usam <code>context_only</code>. Somente resultados realmente confirmados por uma fonte autoritativa poderão usar <code>confirmed_result</code>.
                </p>
              </div>
            </div>
          </section>

          {!user ? (
            <p className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] text-amber-200">
              Entre no Kyrub para visualizar a linha do tempo deste perfil.
            </p>
          ) : (
            <>
              <section className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-cyan-300" />
                  <div>
                    <strong className="block text-[9px] text-white">
                      {events.length} evento(s) local(is)
                    </strong>
                    <span className="text-[8px] text-slate-500">
                      limite atual: 80 por perfil neste navegador
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearTimeline}
                  className="flex min-h-9 items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 text-[8px] font-black uppercase text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Limpar local
                </button>
              </section>

              {events.length === 0 ? (
                <p className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-[9px] leading-relaxed text-slate-400">
                  Ainda não há eventos. Feche este diagnóstico, navegue pelo Kyrub — por exemplo Notas, Renda, Kyrub, ERP ou Comunidades — e depois abra esta tela novamente.
                </p>
              ) : (
                <div className="space-y-2">
                  {[...events].reverse().map(event => (
                    <article
                      key={event.id}
                      className="rounded-2xl border border-slate-800 bg-slate-950 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="text-[7px] font-black uppercase text-cyan-300">
                            {eventTitle(event)} · {event.domain}
                          </span>
                          <strong className="mt-1 block break-all font-mono text-[9px] text-white">
                            {event.screenId ?? event.actionId ?? event.entityType ?? event.type}
                          </strong>
                        </div>
                        <span className="shrink-0 font-mono text-[8px] text-slate-500">
                          {formatTime(event.occurredAt)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[7px] font-black uppercase">
                        <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-400">
                          {event.type}
                        </span>
                        <span className={`rounded-full border px-2 py-1 ${
                          event.authority === 'confirmed_result'
                            ? 'border-emerald-500/30 text-emerald-300'
                            : 'border-amber-500/30 text-amber-300'
                        }`}>
                          {event.authority}
                        </span>
                      </div>
                      {event.entityId && (
                        <p className="mt-2 break-all font-mono text-[7px] text-slate-600">
                          entityId: {event.entityId}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
