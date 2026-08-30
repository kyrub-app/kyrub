import { useEffect, useState } from 'react';
import { CircleDollarSign, RefreshCw } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../utils/firebase';

interface EarningsSnapshot {
  currency: 'BRL';
  totals: {
    projectedMinor: number;
    eligibleMinor: number;
    settledMinor: number;
    reversedMinor: number;
  };
  integrityErrorCount: number;
}

const EMPTY: EarningsSnapshot = {
  currency: 'BRL',
  totals: {
    projectedMinor: 0,
    eligibleMinor: 0,
    settledMinor: 0,
    reversedMinor: 0,
  },
  integrityErrorCount: 0,
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(minor / 100);

const load = async (): Promise<EarningsSnapshot> => {
  const user = auth.currentUser;
  if (!user) return EMPTY;
  const token = await user.getIdToken();
  const response = await fetch('/api/delivery-opportunities/earnings', {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as Partial<EarningsSnapshot> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível consultar seus ganhos de entrega.');
  }
  return {
    currency: 'BRL',
    totals: {
      projectedMinor: Number(payload.totals?.projectedMinor ?? 0),
      eligibleMinor: Number(payload.totals?.eligibleMinor ?? 0),
      settledMinor: Number(payload.totals?.settledMinor ?? 0),
      reversedMinor: Number(payload.totals?.reversedMinor ?? 0),
    },
    integrityErrorCount: Number(payload.integrityErrorCount ?? 0),
  };
};

export function CourierEarningsProjectionCard() {
  const [snapshot, setSnapshot] = useState<EarningsSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = (): void => {
    if (!auth.currentUser) {
      setSnapshot(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    void load()
      .then(setSnapshot)
      .catch(value => {
        setError(value instanceof Error ? value.message : 'Ganhos indisponíveis.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      if (!user) {
        setSnapshot(EMPTY);
        setLoading(false);
        return;
      }
      refresh();
    });
    return unsubscribe;
  }, []);

  const totals = snapshot.totals;
  const hasAny = Object.values(totals).some(value => value !== 0);

  return (
    <section className="rounded-3xl border border-cyan-500/20 bg-slate-900 p-5" id="courier-earnings-projection">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CircleDollarSign className="h-4 w-4 text-cyan-300" />
            <h3 className="text-xs font-black uppercase tracking-wider text-white">
              Ganhos em entregas
            </h3>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
            Projeção econômica das suas entregas Kyrub. Elegível e liquidado são estados diferentes.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-xl border border-slate-700 p-2 text-slate-400 disabled:opacity-50"
          aria-label="Atualizar ganhos em entregas"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Previsto', totals.projectedMinor],
          ['Elegível', totals.eligibleMinor],
          ['Liquidado', totals.settledMinor],
          ['Revertido', totals.reversedMinor],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <p className="text-[8px] font-black uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-1 text-sm font-black text-white">{money(Number(value))}</p>
          </div>
        ))}
      </div>

      {!loading && !error && !hasAny && (
        <p className="mt-3 text-[9px] text-slate-500">
          Nenhuma obrigação econômica de entrega foi projetada para você ainda.
        </p>
      )}
      {snapshot.integrityErrorCount > 0 && (
        <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[9px] text-amber-200">
          {snapshot.integrityErrorCount} lançamento(s) ficaram fora dos totais por inconsistência de integridade.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
