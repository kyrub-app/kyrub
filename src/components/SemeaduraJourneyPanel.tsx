import { useEffect, useState } from 'react';
import { calculatePitangueiraJourney, SEEDS_PER_BROTO, SEEDS_PER_MUDA, SEEDS_PER_PITANGUEIRA, SEEDS_PER_BOSQUE } from '../../shared/pitangueiraJourney';
import { requestSemeadura, SEMEADURA_UI_ENABLED } from './SemearButton';

/** The cocar marks XP from the canonical rewards account, never converted from seeds. */
function CocarXpIcon() {
  return (
    <svg viewBox="0 0 40 40" className="mx-auto h-6 w-6 text-amber-300"
      fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      strokeWidth="1.8" aria-hidden="true">
      <path d="M20 21V3M16 21 10 5M24 21 30 5M12 23 4 12M28 23 36 12M9 26 2 22M31 26 38 22" />
      <path d="M20 3 17 8l3 6 3-6-3-5ZM10 5 7 12l5 4 1-7-3-4ZM30 5l-3 4 1 7 5-4-3-7ZM4 12l-2 7 7 3-1-7-4-3ZM36 12l-4 3-1 7 7-3-2-7Z" />
      <path d="M9 26c5-6 17-6 22 0v4H9v-4ZM13 30v4c4 4 10 4 14 0v-4M16 26h8" />
      <path d="M17 30h6" />
    </svg>
  );
}

/**
 * Informational only: rewards are NOT credited by this panel. This one panel
 * works for the private author's trajectory and a community's public history.
 */
export function SemeaduraJourneyPanel({
  viewerId, communityId, xp,
}: { viewerId: string; communityId?: string; xp?: number | null }) {
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setTotal(null);
    setError('');
    if (!SEMEADURA_UI_ENABLED || !viewerId) return () => controller.abort();
    const read = async () => {
      const result = await requestSemeadura(
        communityId ? 'community-journey' : 'journey',
        communityId ? { communityId } : undefined,
        controller.signal,
      );
      const raw = result.journey;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('SEMEADURA_JOURNEY_INVALID');
      }
      const journey = raw as Record<string, unknown>;
      if (!Number.isSafeInteger(journey.totalSeeds) ||
          Number(journey.totalSeeds) < 0 ||
          journey.bosques !== Math.floor(Number(journey.totalSeeds) / SEEDS_PER_BOSQUE) ||
          journey.pitangueiras !== Math.floor(Number(journey.totalSeeds) / 1000)) {
        throw new Error('SEMEADURA_JOURNEY_INVALID');
      }
      if (!controller.signal.aborted) setTotal(Number(journey.totalSeeds));
    };
    void read().catch(() => {
      if (!controller.signal.aborted) setError('A jornada está indisponível neste momento.');
    });
    const onUpdate = () => { void read().catch(() => undefined); };
    window.addEventListener('kyrub-semeadura-updated', onUpdate);
    return () => {
      controller.abort();
      window.removeEventListener('kyrub-semeadura-updated', onUpdate);
    };
  }, [viewerId, communityId]);

  if (!SEMEADURA_UI_ENABLED) return null;
  const journey = calculatePitangueiraJourney(total ?? 0);
  const remainingToBosque = SEEDS_PER_BOSQUE - journey.totalSeeds % SEEDS_PER_BOSQUE;
  const showCanonicalXp = !communityId && xp !== undefined;
  return (
    <section aria-label={communityId ? 'Jornada coletiva da Pitangueira' : 'Minha Jornada da Pitangueira'}
      className="rounded-2xl border border-emerald-800/30 bg-emerald-950/10 p-3 text-slate-200">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black text-emerald-200">🌳 Jornada da Pitangueira</h3>
        <span className="text-xs font-bold text-emerald-300">🌲 {total === null ? '…' : journey.bosques.toLocaleString('pt-BR')} bosques</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {communityId
          ? 'Crescimento coletivo de todas as publicações desta comunidade.'
          : 'Suas semeaduras recebidas em publicações pessoais e comunitárias.'}
      </p>
      <div className={`mt-3 grid grid-cols-3 gap-2 text-center ${showCanonicalXp ? "sm:grid-cols-3" : "sm:grid-cols-5"}`} aria-label="Etapas da Jornada da Pitangueira">
        {([
          ['🌰', 'Sementes', journey.totalSeeds],
          ['🌱', 'Brotos', Math.floor(journey.totalSeeds / SEEDS_PER_BROTO)],
          ['🌿', 'Mudas', Math.floor(journey.totalSeeds / SEEDS_PER_MUDA)],
          ['🌳', 'Pitangueiras', Math.floor(journey.totalSeeds / SEEDS_PER_PITANGUEIRA)],
          ['🌲', 'Bosques', journey.bosques],
        ] as Array<[string, string, number]>).map(([symbol, stage, count]) => (
          <div key={stage} className="min-w-0 rounded-xl bg-slate-900 p-2">
            <span className="block text-lg" aria-hidden="true">{symbol}</span>
            <strong className="block text-sm tabular-nums">
              {total === null ? '…' : count.toLocaleString('pt-BR')}
            </strong>
            <span className="block text-[10px] text-slate-400">{stage}</span>
          </div>
        ))}
        {showCanonicalXp && (
          <div className="min-w-0 rounded-xl border border-amber-500/25 bg-amber-500/5 p-2" aria-label="Cocar, XP da conta de recompensas">
            <CocarXpIcon />
            <strong className="block text-sm tabular-nums">
              {xp === null ? '…' : (Number.isSafeInteger(xp) && xp >= 0 ? xp.toLocaleString('pt-BR') : '…')}
            </strong>
            <span className="block text-[10px] text-amber-200">Cocar · XP</span>
          </div>
        )}
      </div>
      <progress className="mt-3 block h-2 w-full accent-emerald-500"
        aria-label="Progresso até o próximo bosque"
        value={journey.totalSeeds % SEEDS_PER_BOSQUE} max={SEEDS_PER_BOSQUE} />
      {total !== null && (
        <p className="mt-1 text-[11px] text-slate-400">
          {remainingToBosque.toLocaleString('pt-BR')} sementes até o próximo bosque.
        </p>
      )}
      {!communityId && (
        <p className="mt-2 text-[11px] text-amber-200">
          🍒 {journey.pitangasEquivalent.toLocaleString('pt-BR')} Pitangas equivalentes
          pelo progresso, ainda não creditadas. O saldo disponível fica no extrato.
        </p>
      )}
      {communityId && (
        <p className="mt-2 text-[11px] text-slate-400">
          Esta jornada é visual. As recompensas pertencem aos autores, não à comunidade.
        </p>
      )}
      {error && <p role="status" className="mt-2 text-xs text-amber-300">{error}</p>}
    </section>
  );
}
