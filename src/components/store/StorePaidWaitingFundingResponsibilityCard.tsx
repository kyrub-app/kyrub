import { useCallback, useEffect, useState } from 'react';
import { Clock3, RefreshCw } from 'lucide-react';
import { auth } from '../../utils/firebase';

interface ResponsibilitySnapshot {
  payerPrincipalId: string;
  totals: {
    currency: 'BRL';
    pendingMinor: number;
    eligibleMinor: number;
    settledObligationMinor: number;
    reversedMinor: number;
    entryCount: number;
  };
}

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(minor / 100);

export function StorePaidWaitingFundingResponsibilityCard() {
  const [snapshot, setSnapshot] = useState<ResponsibilitySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/paid-waiting-funding-responsibility/store', {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({})) as ResponsibilitySnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Responsabilidade de espera indisponível.');
      setSnapshot(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Responsabilidade de espera indisponível.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section
      id="store-paid-waiting-funding-responsibility"
      className="mb-4 rounded-3xl border border-amber-500/20 bg-slate-900 p-5 text-slate-100"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-2xl bg-amber-500/10 p-2.5 text-amber-300">
            <Clock3 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-white">
              Espera remunerada · responsabilidade da loja
            </h3>
            <p className="mt-1 max-w-2xl text-[9px] leading-relaxed text-slate-500">
              Valores atribuídos à loja pela política congelada da entrega. Esta leitura não registra saída no caixa, não confirma débito e não representa saldo.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400 disabled:opacity-50"
          aria-label="Atualizar responsabilidade de espera da loja"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {snapshot && (
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            ['Prevista', snapshot.totals.pendingMinor],
            ['Elegível', snapshot.totals.eligibleMinor],
            ['Obrigação liquidada', snapshot.totals.settledObligationMinor],
            ['Revertida', snapshot.totals.reversedMinor],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <span className="text-[8px] font-black uppercase tracking-wider text-slate-600">{label}</span>
              <strong className="mt-1 block text-sm text-white">{money(Number(value))}</strong>
            </div>
          ))}
        </div>
      )}

      {snapshot && (
        <p className="mt-3 text-[8px] text-slate-600">
          {snapshot.totals.entryCount} obrigação(ões) · “obrigação liquidada” descreve o estado do payable do entregador, não um débito bancário da loja.
        </p>
      )}
      {error && <p className="mt-3 text-[9px] text-rose-300">{error}</p>}
    </section>
  );
}
