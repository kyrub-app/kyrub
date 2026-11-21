import { useState } from 'react';
import { BadgeCheck, CalendarDays, Gift, RefreshCw, Target } from 'lucide-react';
import type { PlatformChallengeCatalog, PlatformChallengeView } from '../../shared/platformChallengeCatalog';

type CatalogProps = {
  catalog: PlatformChallengeCatalog | null;
  loading: boolean;
  error: string;
};

const rewardLabel = (challenge: PlatformChallengeView): string => {
  const rewards = [
    challenge.rewardXp > 0 ? `${challenge.rewardXp} XP` : '',
    challenge.rewardPitangas > 0 ? `${challenge.rewardPitangas.toLocaleString('pt-BR')} Pitangas` : '',
  ].filter(Boolean);
  return rewards.length ? rewards.join(' + ') : 'Sem recompensa cadastrada';
};

/** Brief preview inside the existing full-width Central Pessoal button. */
export function PlatformChallengeSummary({ catalog, loading, error }: CatalogProps) {
  const featured = catalog?.challenges.find(item => item.status === 'available');
  return (
    <span className="mt-3 block border-t border-slate-700/80 pt-3 text-left">
      {loading ? <span className="block text-[10px] text-slate-400">Consultando desafios publicados…</span>
        : error ? <span className="block text-[10px] text-amber-200">Desafios indisponíveis. Toque para tentar novamente.</span>
        : featured ? <>
          <span className="block text-[10px] font-bold text-orange-300">
            {catalog?.availableCount} {catalog?.availableCount === 1 ? 'desafio disponível' : 'desafios disponíveis'}
          </span>
          <span className="mt-1 block text-[10px] font-semibold text-white">{featured.title}</span>
          <span className="mt-1 block text-[10px] text-slate-300">Recompensa prevista: {rewardLabel(featured)}</span>
        </> : <span className="block text-[10px] text-slate-400">
          {catalog?.completedCount ? `${catalog.completedCount} desafio(s) concluído(s). Confira o histórico.` :
            'Nenhum desafio publicado disponível no momento.'}
        </span>}
      <span className="mt-3 block text-[10px] font-bold text-orange-300">Ver desafios</span>
    </span>
  );
}

/** Read-only challenge discovery. A card click never claims a reward. */
export function PlatformChallengesPanel({
  catalog, loading, error, onRetry,
}: CatalogProps & { onRetry: () => void }) {
  const [filter, setFilter] = useState<'available' | 'completed' | 'all'>('available');
  const visible = (catalog?.challenges ?? []).filter(item => filter === 'all' || item.status === filter);
  const options = [
    { id: 'available', label: 'Disponíveis', count: catalog?.availableCount ?? 0 },
    { id: 'completed', label: 'Concluídos', count: catalog?.completedCount ?? 0 },
    { id: 'all', label: 'Todos', count: catalog?.challenges.length ?? 0 },
  ] as const;

  return <div id="personal-platform-challenges" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-[10px] leading-relaxed text-slate-300">
          Missões publicadas pelo Kyrub. Acompanhe o que está disponível e suas conclusões confirmadas.
        </p>
      </div>
      <button type="button" onClick={onRetry} disabled={loading}
        aria-label="Atualizar desafios"
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-[10px] font-bold text-slate-200 disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Atualizar
      </button>
    </div>

    {loading && <p role="status" className="rounded-xl border border-slate-700 p-4 text-[10px] text-slate-300">Carregando desafios…</p>}
    {error && !loading && <div role="alert" className="rounded-xl border border-amber-500/30 p-4">
      <p className="text-[10px] text-amber-200">{error}</p>
      <button type="button" onClick={onRetry} className="mt-2 min-h-10 rounded-lg border border-amber-500/40 px-3 text-[10px] font-bold text-amber-200">Tentar novamente</button>
    </div>}

    {!loading && !error && <>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
          <span className="block text-lg font-black text-orange-300">{catalog?.availableCount ?? 0}</span>
          <span className="text-[10px] text-slate-300">Disponíveis</span>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
          <span className="block text-lg font-black text-emerald-300">{catalog?.completedCount ?? 0}</span>
          <span className="text-[10px] text-slate-300">Concluídos com registro</span>
        </div>
      </div>
      <div role="group" aria-label="Filtrar desafios" className="flex flex-wrap gap-2">
        {options.map(option => <button key={option.id} type="button" aria-pressed={filter === option.id}
          onClick={() => setFilter(option.id)}
          className={`min-h-10 rounded-full border px-3 py-2 text-[10px] font-bold transition-colors ${filter === option.id
            ? 'border-orange-500/70 bg-orange-500/15 text-orange-200'
            : 'border-slate-700 bg-slate-950 text-slate-300'}`}>
          {option.label} ({option.count})
        </button>)}
      </div>
      {visible.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 p-5 text-center">
        <Target className="mx-auto h-6 w-6 text-orange-300" aria-hidden="true" />
        <p className="mt-2 text-[10px] text-slate-300">
          {filter === 'completed' ? 'Nenhum desafio concluído com registro até agora.' :
            filter === 'available' ? 'Nenhum desafio disponível no momento.' :
              'Ainda não existem desafios publicados para exibir.'}
        </p>
      </div> : <ul className="space-y-3">
        {visible.map(challenge => <li key={challenge.id} className="rounded-2xl border border-slate-700 bg-slate-950 p-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-black text-orange-300">
              {challenge.status === 'completed' ? <BadgeCheck className="h-4 w-4" /> : <Target className="h-4 w-4" />}
              {challenge.status === 'completed' ? 'Concluído' : 'Disponível'}
            </span>
            <span className="text-[10px] text-slate-400">Promovido pelo Kyrub</span>
          </div>
          <h5 className="mt-2 break-words text-sm font-black text-white">{challenge.title}</h5>
          <p className="mt-1 whitespace-pre-line break-words text-[10px] leading-relaxed text-slate-300">{challenge.description}</p>
          <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-3 text-[10px] text-slate-300">
            <p className="flex items-center gap-2"><Gift className="h-4 w-4 shrink-0 text-orange-300" aria-hidden="true" />
              Recompensa prevista: <strong className="text-slate-100">{rewardLabel(challenge)}</strong>
            </p>
            {challenge.endsAt && <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
              Encerramento: {new Date(challenge.endsAt).toLocaleDateString('pt-BR')}</p>}
            {challenge.status === 'completed' ?
              <p className="text-emerald-300">{challenge.completionsConfirmed} conclusão(ões) confirmada(s) por comprovante.</p> :
              <p className="text-slate-400">O progresso aparece após confirmação pelo sistema.</p>}
          </div>
        </li>)}
      </ul>}
      <p className="text-[9px] leading-relaxed text-slate-400">
        Abrir desafios não concede recompensas. XP e Pitangas só são creditados por eventos confirmados pelo sistema.
      </p>
    </>}
  </div>;
}
