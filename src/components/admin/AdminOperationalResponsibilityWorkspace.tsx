import { useEffect, useState } from 'react';
import { CircleAlert, RefreshCw, Route, ShieldAlert } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { AdminProfile } from '../../utils/adminControlPlane';
import {
  loadAdminOperationalResponsibilityReview,
  type AdminResponsibilityReviewSnapshot,
} from '../../utils/adminOperationalResponsibility';

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sem horário válido' : date.toLocaleString('pt-BR');
};

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining ? `${minutes}min ${remaining}s` : `${minutes}min`;
};

const actorLabel = (value: string): string => ({
  store: 'Loja',
  courier: 'Entregador',
  customer: 'Cliente',
  external: 'Externo',
  undetermined: 'Indeterminado',
}[value] ?? value);

const reasonLabel = (value: string): string => ({
  insufficient_evidence: 'Evidência insuficiente',
  location_evidence_conflict: 'Conflito de localização',
  store_not_ready_after_free_window: 'Loja não pronta após tolerância',
  courier_delayed_pickup_after_ready: 'Coleta atrasada após pedido pronto',
  customer_not_available_after_free_window: 'Cliente indisponível após tolerância',
}[value] ?? value);

export default function AdminOperationalResponsibilityWorkspace({
  authenticatedUser,
  profile,
}: {
  authenticatedUser: User;
  profile: AdminProfile;
}) {
  const [snapshot, setSnapshot] = useState<AdminResponsibilityReviewSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      setSnapshot(await loadAdminOperationalResponsibilityReview(authenticatedUser, profile));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a fila.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile.status !== 'active' || (profile.role !== 'super_admin' && profile.role !== 'operations')) return;
    void refresh();
  }, [authenticatedUser.uid, profile.role, profile.status]);

  if (profile.status !== 'active' || (profile.role !== 'super_admin' && profile.role !== 'operations')) return null;

  return (
    <section id="admin-operational-responsibility" aria-labelledby="admin-operational-responsibility-title" className="rounded-[2rem] border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-300">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-400">Responsabilidade Operacional</span>
            <h2 id="admin-operational-responsibility-title" className="mt-1 text-lg font-black text-white">Fila de revisão humana</h2>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
              Casos em que o motor recusou atribuição automática ou identificou incidente externo. Esta tela é somente leitura: revisar não altera obrigação, pagamento, reputação ou saldo.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 hover:bg-slate-700 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="mt-4 flex gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-slate-800 bg-slate-950/45 p-4">
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Revisão necessária</span>
          <strong className="mt-2 block text-2xl font-black text-white">{snapshot?.counts.reviewRequired ?? '—'}</strong>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-950/45 p-4">
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Incidente externo</span>
          <strong className="mt-2 block text-2xl font-black text-white">{snapshot?.counts.external ?? '—'}</strong>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-950/45 p-4">
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Exibidos</span>
          <strong className="mt-2 block text-2xl font-black text-white">{snapshot?.counts.visible ?? '—'}</strong>
        </article>
      </div>

      <div className="mt-5 space-y-3">
        {(snapshot?.items ?? []).map(item => (
          <article key={item.deliveryId} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Route className="h-4 w-4 text-cyan-300" />
                  <strong className="text-xs text-white">Entrega {item.deliveryId}</strong>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">Pedido {item.orderId || 'não informado'} · Loja {item.storeId || 'não informada'}</p>
              </div>
              <span className={`w-fit rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${item.status === 'external' ? 'border-violet-500/30 text-violet-300' : 'border-amber-500/30 text-amber-300'}`}>
                {item.status === 'external' ? 'Incidente externo' : 'Revisão necessária'}
              </span>
            </div>

            <div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-3">
              <div className="rounded-xl border border-slate-800 p-3"><span className="block text-slate-600">Avaliado em</span><strong className="mt-1 block text-slate-300">{formatDate(item.assessedAt)}</strong></div>
              <div className="rounded-xl border border-slate-800 p-3"><span className="block text-slate-600">Política</span><strong className="mt-1 block text-slate-300">{item.policyId || '—'} v{item.policyVersion || '—'}</strong></div>
              <div className="rounded-xl border border-slate-800 p-3"><span className="block text-slate-600">Decisão econômica</span><strong className="mt-1 block text-slate-300">{item.economicDecisionStatus || '—'}</strong></div>
            </div>

            {item.intervals.length > 0 && (
              <div className="mt-3 space-y-2">
                {item.intervals.map((interval, index) => (
                  <div key={`${item.deliveryId}-${index}`} className="flex flex-col gap-1 rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-[10px] sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-slate-300">{actorLabel(interval.responsibleActor)} · {reasonLabel(interval.reasonCode)}</span>
                    <span className="text-slate-500">{interval.evidenceStatus} · {formatDuration(interval.durationSeconds)}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>

      {!loading && snapshot && snapshot.items.length === 0 && !error && (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-800 p-5 text-center text-xs text-slate-500">Nenhum caso aguardando revisão neste recorte.</div>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-slate-600">Última leitura: {snapshot ? formatDate(snapshot.generatedAt) : 'ainda não carregada'}. A fila não permite decisão manual nesta versão.</p>
    </section>
  );
}
