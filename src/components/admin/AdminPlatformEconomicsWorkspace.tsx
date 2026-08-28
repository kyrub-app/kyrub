import { useEffect, useMemo, useState } from 'react';
import { Banknote, CircleAlert, RefreshCw } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  hasAdminPermission,
  subscribeToAdminProfile,
  type AdminProfile,
} from '../../utils/adminControlPlane';
import {
  loadAdminPlatformEconomics,
} from '../../utils/adminPlatformEconomics';
import type { KyrubPlatformEconomicsSummary } from '../../../shared/kyrubPlatformEconomics';

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(minor / 100);

export default function AdminPlatformEconomicsWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [snapshot, setSnapshot] = useState<KyrubPlatformEconomicsSummary | null>(null);
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
    user && profile && hasAdminPermission(profile, 'read_finance')
  );

  const refresh = async (): Promise<void> => {
    if (!user || !profile || !authorized) return;
    setLoading(true);
    try {
      setSnapshot(await loadAdminPlatformEconomics(user, profile));
      setError('');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível consultar a economia da plataforma.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authorized) return;
    void refresh();
    // Financial data is immutable; one-minute refresh is enough for the control plane.
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(interval);
    // refresh intentionally follows the current authenticated state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, profile, user]);

  const cards = useMemo(() => {
    if (!snapshot) return [];
    return [
      ['GMV canônico', snapshot.totals.gmvMinor, 'Soma das vendas registradas no ledger.'],
      ['Pago por consumidores', snapshot.totals.consumerPaidMinor, 'Posição líquida dos compradores.'],
      ['Receita Kyrub', snapshot.totals.platformRevenueMinor, 'Somente platform_fee destinada à Kyrub.'],
      ['Custos Kyrub', snapshot.totals.platformCostsMinor, 'Valores explicitamente financiados pela plataforma.'],
      ['Posição líquida Kyrub', snapshot.totals.platformNetMinor, 'Créditos menos débitos registrados.'],
      ['Trabalhadores', snapshot.totals.workerEarningsMinor, 'Valores destinados a entregadores e prestadores.'],
      ['Subsídios', snapshot.totals.subsidiesMinor, 'Subsídios economicamente registrados.'],
      ['Incentivos', snapshot.totals.incentivesMinor, 'Bônus e incentivos registrados.'],
    ] as const;
  }, [snapshot]);

  if (!authorized || !user || !profile) return null;

  return (
    <section className="bg-slate-950 px-4 pb-10 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-7xl rounded-[2rem] border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-300">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400">
                Economia da Plataforma
              </span>
              <h2 className="mt-1 text-lg font-black text-white">
                Verdade econômica derivada do ledger
              </h2>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                Indicadores calculados no servidor sobre lançamentos imutáveis; o navegador não lê nem altera o ledger diretamente.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Consultando' : 'Atualizar'}
          </button>
        </div>

        {error && (
          <div className="mt-4 flex gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(([label, value, detail]) => (
            <article key={label} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</span>
              <strong className="mt-3 block text-xl font-black text-white">{money(value)}</strong>
              <p className="mt-1 text-[9px] leading-relaxed text-slate-500">{detail}</p>
            </article>
          ))}
        </div>

        {snapshot && (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
              <h3 className="text-xs font-black text-white">Cobertura contábil</h3>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                {snapshot.includedLedgers.toLocaleString('pt-BR')} ledger(s) incluído(s) de {snapshot.scannedLedgers.toLocaleString('pt-BR')} consultado(s).
                {snapshot.truncated ? ' A consulta atingiu o limite de segurança e deve ser refinada por período.' : ''}
              </p>
              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] leading-relaxed text-amber-200">
                Custos de IA e infraestrutura ainda estão marcados como não modelados. Eles não são exibidos como zero até existir uma fonte econômica autoritativa.
              </div>
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
              <h3 className="text-xs font-black text-white">Meios de pagamento</h3>
              <div className="mt-3 space-y-2">
                {snapshot.byPaymentMethod.length === 0 && (
                  <p className="text-[10px] text-slate-600">Ainda não há transações econômicas registradas.</p>
                )}
                {snapshot.byPaymentMethod.map(row => (
                  <div key={row.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 px-3 py-2">
                    <span className="text-[10px] font-bold uppercase text-slate-400">{row.key}</span>
                    <span className="text-[10px] font-black text-slate-200">{money(row.gmvMinor)}</span>
                  </div>
                ))}
              </div>
            </article>
          </div>
        )}
      </div>
    </section>
  );
}
