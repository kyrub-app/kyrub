import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

type Counts = {
  users: number | null;
  canonicalStores: number | null;
  activePaidOwners: number | null;
  paidStoreConversionPercent: number | null;
};

const show = (value: number | null, percent = false): string =>
  value === null ? 'Indisponível' : percent
    ? `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
    : value.toLocaleString('pt-BR');

export default function AdminEcosystemFunnel({ user }: { user: User }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setCounts(null);
    setError('');
    void user.getIdToken().then(token => fetch('/api/admin/ecosystem-funnel', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })).then(async response => {
      if (!response.ok) throw new Error('Consulta administrativa indisponível.');
      return response.json() as Promise<Counts>;
    }).then(data => { if (!controller.signal.aborted) setCounts(data); })
      .catch(() => { if (!controller.signal.aborted) setError('Não foi possível consultar os indicadores agora.'); });
    return () => controller.abort();
  }, [user]);

  if (error) return <p role="alert" className="mt-3 text-xs text-amber-300">{error}</p>;
  if (!counts) return <p className="mt-3 text-xs text-slate-400">Consultando indicadores...</p>;
  const items = [
    ['Cairubidos cadastrados', show(counts.users)],
    ['Lojas canônicas', show(counts.canonicalStores)],
    ['Assinantes pagos ativos', show(counts.activePaidOwners)],
    ['Conversão paga por loja', show(counts.paidStoreConversionPercent, true)],
  ];
  return <section className="mt-4" aria-label="Indicadores do ecossistema">
    <h3 className="mb-3 text-xs font-black uppercase text-white">Funil do ecossistema</h3>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
        <span className="text-[9px] font-black uppercase text-slate-500">{label}</span>
        <strong className="mt-2 block text-xl font-black text-white">{value}</strong>
      </article>)}
    </div>
  </section>;
}
