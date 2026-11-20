import { useEffect, useState } from 'react';
import { calculatePitangueiraJourney, SEEDS_PER_BOSQUE } from '../../shared/pitangueiraJourney';
import { requestSemeadura, SEMEADURA_UI_ENABLED } from './SemearButton';

/**
 * Informational only: rewards are NOT credited by this panel. This one panel
 * works for the private author's trajectory and a community's public history.
 */
export function SemeaduraJourneyPanel({
  viewerId, communityId,
}: { viewerId: string; communityId?: string }) {
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
  return (
    <section aria-label={communityId ? 'Jornada coletiva da Pitangueira' : 'Minha Jornada da Pitangueira'}
      className="rounded-2xl border border-emerald-800/30 bg-emerald-950/10 p-3 text-slate-200">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black text-emerald-200">🌳 Jornada da Pitangueira</h3>
        <span className="text-xs font-bold text-emerald-300">🌲 {journey.bosques.toLocaleString('pt-BR')} bosques</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {communityId
          ? 'Crescimento coletivo de todas as publicações desta comunidade.'
          : 'Suas semeaduras recebidas em publicações pessoais e comunitárias.'}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-900 p-2">
          <span className="block text-lg" aria-hidden="true">🌰</span>
          <strong className="block text-sm">{total === null ? '…' : journey.totalSeeds.toLocaleString('pt-BR')}</strong>
          <span className="text-[10px] text-slate-400">Sementes</span>
        </div>
        <div className="rounded-xl bg-slate-900 p-2">
          <span className="block text-lg" aria-hidden="true">🌱</span>
          <strong className="block text-sm">{total === null ? '…' : journey.mudas.toLocaleString('pt-BR')}</strong>
          <span className="text-[10px] text-slate-400">Mudas atuais</span>
        </div>
        <div className="rounded-xl bg-slate-900 p-2">
          <span className="block text-lg" aria-hidden="true">🌳</span>
          <strong className="block text-sm">{total === null ? '…' : journey.pitangueiras.toLocaleString('pt-BR')}</strong>
          <span className="text-[10px] text-slate-400">Pitangueiras</span>
        </div>
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
