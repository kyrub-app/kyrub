import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, RefreshCw, ShieldCheck, UserCheck, Users } from 'lucide-react';
import {
  loadStoreTeamAccess,
  type StoreTeamAccessSnapshot,
  type StoreTeamMembershipStatus,
  type StoreTeamRole,
} from '../../utils/storeTeamAccess';

const ROLE_LABELS: Record<StoreTeamRole, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  cashier: 'Caixa',
  seller: 'Vendas',
  production: 'Produção',
};

const STATUS_LABELS: Record<StoreTeamMembershipStatus, string> = {
  invited: 'Convite pendente',
  active: 'Ativo',
  suspended: 'Suspenso',
  removed: 'Removido',
};

const statusClass = (status: StoreTeamMembershipStatus): string => {
  if (status === 'active') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
  if (status === 'invited') return 'border-amber-500/25 bg-amber-500/10 text-amber-200';
  if (status === 'suspended') return 'border-red-500/25 bg-red-500/10 text-red-200';
  return 'border-slate-700 bg-slate-800/70 text-slate-400';
};

const formatDate = (value: string): string => {
  if (!value) return '';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(parsed));
};

export default function StoreTeamAccessWorkspace({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  const [snapshot, setSnapshot] = useState<StoreTeamAccessSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSnapshot(await loadStoreTeamAccess(user, storeId));
    } catch (loadError) {
      setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a equipe da loja.');
    } finally {
      setLoading(false);
    }
  }, [storeId, user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section
      className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6"
      id="kyrub-store-team-access"
      data-kyrub-team-access="read-only"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-pink-300">
              Equipe & Permissões
            </span>
            <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 font-mono text-[8px] font-black uppercase text-cyan-200">
              Somente leitura
            </span>
          </div>
          <h3 className="mt-1 text-base font-black text-white">Vínculos canônicos da loja</h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Esta visão lê somente memberships reais da loja canônica. Convites, cargos e estados não são alterados por este painel.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-[10px] leading-relaxed text-slate-400">
        <span className="inline-flex items-center gap-2 font-black text-slate-200">
          <ShieldCheck className="h-4 w-4 text-cyan-300" />
          Autoridade existente preservada
        </span>
        <p className="mt-1">
          Papéis válidos: proprietário, gerente, caixa, vendas e produção. Estados válidos: convidado, ativo, suspenso e removido. Nenhum papel adicional é criado por esta interface.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-4 text-[10px] leading-relaxed text-red-100" role="alert">
          {error}
        </div>
      )}

      {snapshot?.sourceWarnings.length ? (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-[10px] leading-relaxed text-amber-100">
          <div className="flex items-center gap-2 font-black">
            <AlertTriangle className="h-4 w-4" />
            Atenção na fonte canônica
          </div>
          <p className="mt-1">
            Foram detectadas {snapshot.sourceWarnings.length} inconsistência(s) ou fonte(s) indisponível(is). Nenhum vínculo foi inventado para preencher a lista.
          </p>
        </div>
      ) : null}

      {loading && !snapshot ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-[10px] text-slate-500">
          Carregando vínculos canônicos da equipe…
        </div>
      ) : snapshot && snapshot.members.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {snapshot.members.map(member => (
            <article key={member.memberRef} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {member.isCanonicalOwner ? (
                      <ShieldCheck className="h-4 w-4 shrink-0 text-orange-300" />
                    ) : (
                      <UserCheck className="h-4 w-4 shrink-0 text-pink-300" />
                    )}
                    <strong className="truncate text-[11px] text-white">
                      {member.displayName || 'Membro sem nome público disponível'}
                    </strong>
                  </div>
                  {member.maskedEmail && (
                    <span className="mt-1 block truncate text-[9px] text-slate-500">{member.maskedEmail}</span>
                  )}
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-1 font-mono text-[8px] font-black uppercase ${statusClass(member.status)}`}>
                  {STATUS_LABELS[member.status]}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
                  <span className="block text-[8px] font-black uppercase text-slate-600">Papel</span>
                  <strong className="mt-0.5 block text-[10px] text-slate-200">{ROLE_LABELS[member.role]}</strong>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
                  <span className="block text-[8px] font-black uppercase text-slate-600">Autoridade</span>
                  <strong className="mt-0.5 block text-[10px] text-slate-200">
                    {member.isCanonicalOwner ? 'Owner canônico' : 'Membership canônica'}
                  </strong>
                </div>
              </div>

              {(member.acceptedAt || member.invitedAt || member.updatedAt) && (
                <p className="mt-3 text-[9px] leading-relaxed text-slate-600">
                  {member.acceptedAt
                    ? `Ativo desde ${formatDate(member.acceptedAt)}`
                    : member.invitedAt
                      ? `Convite registrado em ${formatDate(member.invitedAt)}`
                      : `Atualizado em ${formatDate(member.updatedAt)}`}
                </p>
              )}
            </article>
          ))}
        </div>
      ) : !loading && !error ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-8 text-center">
          <Users className="mx-auto h-5 w-5 text-slate-600" />
          <p className="mt-2 text-[10px] text-slate-500">
            Nenhuma membership canônica real foi encontrada. A interface não cria registros fictícios para preencher este estado.
          </p>
        </div>
      ) : null}
    </section>
  );
}
