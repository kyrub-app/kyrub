import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CircleAlert,
  CircleCheck,
  Clock3,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  hasAdminPermission,
  subscribeToAdminProfile,
  type AdminProfile,
} from '../../utils/adminControlPlane';
import {
  loadAdminOperationsHealth,
  type AdminOperationsHealthSnapshot,
} from '../../utils/adminOperationsHealth';

const STATE_LABELS: Record<AdminOperationsHealthSnapshot['state'], string> = {
  healthy: 'Saudável',
  attention: 'Atenção',
  critical: 'Crítico',
};

const formatUpdatedAt = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Ainda não consultado'
    : date.toLocaleString('pt-BR');
};

export default function AdminSystemHealthWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [snapshot, setSnapshot] = useState<AdminOperationsHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribeProfile = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, nextUser => {
      unsubscribeProfile();
      unsubscribeProfile = () => undefined;
      setUser(nextUser);
      setProfile(null);
      setSnapshot(null);
      setError('');
      if (!nextUser) return;
      unsubscribeProfile = subscribeToAdminProfile(
        nextUser,
        setProfile,
        () => setError('Não foi possível validar o perfil administrativo.')
      );
    });
    return () => {
      unsubscribeProfile();
      unsubscribeAuth();
    };
  }, []);

  const authorized = Boolean(
    user && profile && hasAdminPermission(profile, 'read_system_health')
  );

  useEffect(() => {
    if (!user || !profile || !authorized) return;
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      setLoading(true);
      try {
        const next = await loadAdminOperationsHealth(user, profile);
        if (!cancelled) {
          setSnapshot(next);
          setError('');
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Não foi possível consultar a saúde operacional.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authorized, profile, user]);

  const cards = useMemo(() => {
    if (!snapshot) return [];
    return [
      {
        key: 'ingress',
        label: 'Fila 99Food',
        value: snapshot.integration.queued + snapshot.integration.processing,
        detail: `${snapshot.integration.failed} falha(s) aguardando retentativa`,
        icon: Activity,
      },
      {
        key: 'connections',
        label: 'Conexões 99Food',
        value: snapshot.integration.connected,
        detail: `${snapshot.integration.attention} conexão(ões) requerem atenção`,
        icon: CircleCheck,
      },
      {
        key: 'deliveries',
        label: 'Kyrub Entregas',
        value: snapshot.delivery.available,
        detail: `${snapshot.delivery.accepted + snapshot.delivery.delivering} em execução`,
        icon: Truck,
      },
      {
        key: 'fallback',
        label: 'Fallback logístico',
        value: snapshot.delivery.waitingFallback,
        detail: `${snapshot.delivery.providerEscalations} aguardando provedor externo`,
        icon: Clock3,
      },
    ];
  }, [snapshot]);

  if (!authorized || !user || !profile) return null;

  const handleRefresh = (): void => {
    setLoading(true);
    void loadAdminOperationsHealth(user, profile)
      .then(next => {
        setSnapshot(next);
        setError('');
      })
      .catch(caught => {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Não foi possível consultar a saúde operacional.'
        );
      })
      .finally(() => setLoading(false));
  };

  return (
    <section className="bg-slate-950 px-4 pb-10 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-7xl rounded-[2rem] border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-300">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-400">
                Saúde do sistema
              </span>
              <h2 className="mt-1 text-lg font-black text-white">
                Filas, integrações e logística
              </h2>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                Contagens agregadas pelo backend. Nenhum payload, cliente ou segredo é exposto.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {snapshot && (
              <span
                className={`rounded-full px-3 py-1.5 text-[9px] font-black uppercase tracking-wider ${
                  snapshot.state === 'healthy'
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : snapshot.state === 'attention'
                      ? 'bg-amber-500/10 text-amber-300'
                      : 'bg-red-500/10 text-red-300'
                }`}
              >
                {STATE_LABELS[snapshot.state]}
              </span>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 hover:bg-slate-700 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(card => {
            const Icon = card.icon;
            return (
              <article
                key={card.key}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                    {card.label}
                  </span>
                  <Icon className="h-4 w-4 text-cyan-400" />
                </div>
                <strong className="mt-3 block text-2xl font-black text-white">
                  {card.value.toLocaleString('pt-BR')}
                </strong>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  {card.detail}
                </p>
              </article>
            );
          })}
          {!snapshot && !loading && !error && (
            <div className="rounded-2xl border border-dashed border-slate-800 p-5 text-xs text-slate-500 sm:col-span-2 xl:col-span-4">
              As métricas ainda não foram consultadas.
            </div>
          )}
        </div>

        <p className="mt-4 text-right text-[9px] text-slate-600">
          Última leitura: {formatUpdatedAt(snapshot?.generatedAt ?? '')}
        </p>
      </div>
    </section>
  );
}
