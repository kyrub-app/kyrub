import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { Clock3, RefreshCw } from 'lucide-react';

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

export function AdminPaidWaitingFundingResponsibilityCard({ user }: { user: User }) {
  const [snapshot, setSnapshot] = useState<ResponsibilitySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/paid-waiting-funding-responsibility/kyrub', {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({})) as ResponsibilitySnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Responsabilidade Kyrub de espera indisponível.');
      setSnapshot(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Responsabilidade Kyrub de espera indisponível.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section
      id="admin-paid-waiting-funding-responsibility"
      className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Clock3 className="mt-0.5 h-4 w-4 text-amber-300" />
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-wider text-white">
              Responsabilidade Kyrub · espera remunerada
            </h3>
            <p className="mt-1 max-w-3xl text-[9px] leading-relaxed text-slate-500">
              Obrigações cuja política congelada definiu a Kyrub como pagadora. Estes valores não entram no econômico líquido, não representam caixa movimentado e não são saldo custodial.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400 disabled:opacity-50"
          aria-label="Atualizar responsabilidade Kyrub de espera"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {snapshot && (
        <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
          {[
            ['Prevista', snapshot.totals.pendingMinor],
            ['Elegível', snapshot.totals.eligibleMinor],
            ['Obrigação liquidada', snapshot.totals.settledObligationMinor],
            ['Revertida', snapshot.totals.reversedMinor],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <span className="text-[8px] font-black uppercase tracking-wider text-slate-600">{label}</span>
              <strong className="mt-1 block text-sm text-white">{money(Number(value))}</strong>
            </div>
          ))}
        </div>
      )}
      {snapshot && (
        <p className="mt-2 text-[8px] text-slate-600">
          {snapshot.totals.entryCount} obrigação(ões) · liquidação da obrigação do entregador não comprova débito ou saída de caixa da Kyrub.
        </p>
      )}
      {error && <p className="mt-3 text-[9px] text-rose-300">{error}</p>}
    </section>
  );
}
