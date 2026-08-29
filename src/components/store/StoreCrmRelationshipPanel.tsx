import { useEffect, useMemo, useState } from 'react';
import {
  Award,
  Coins,
  Gift,
  MessageSquareText,
  RefreshCw,
  Search,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { auth } from '../../utils/firebase';
import { loadStoreCrm } from '../../utils/storeCrm';
import { openStoreCustomerChat } from '../../utils/storeCustomerChatEvents';
import type { StoreCrmSummary } from '../../../shared/storeCrm';

export const StoreCrmRelationshipPanel = ({ storeId }: { storeId: string }) => {
  const [summary, setSummary] = useState<StoreCrmSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const refresh = async () => {
    const user = auth.currentUser;
    if (!user || user.uid !== storeId) return;
    setLoading(true);
    try {
      setSummary(await loadStoreCrm(user, storeId));
    } catch (error) {
      console.warn('Store CRM is unavailable.', error);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [storeId]);

  const customers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return summary?.customers ?? [];
    return (summary?.customers ?? []).filter(customer =>
      customer.displayName.toLocaleLowerCase('pt-BR').includes(normalized) ||
      customer.customerId.toLocaleLowerCase('pt-BR').includes(normalized)
    );
  }, [query, summary]);

  return (
    <section className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-4" id="store-crm-relationship-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-slate-100">
            <Users className="h-4 w-4 text-orange-400" />
            <h3 className="text-xs font-black uppercase">CRM · Relacionamento</h3>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">Dados derivados de pagamentos, Pontos da Loja, desafios e resgates.</p>
        </div>
        <button type="button" onClick={() => void refresh()} className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400" aria-label="Atualizar CRM">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3">
        <Search className="h-3.5 w-3.5 text-slate-600" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar cliente" className="min-w-0 flex-1 bg-transparent py-2.5 text-xs text-white outline-none" />
      </div>

      {customers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center text-xs text-slate-500">
          {loading ? 'Carregando relacionamentos…' : 'Nenhum relacionamento canônico encontrado.'}
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {customers.map(customer => (
            <article key={customer.customerId} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-xs text-white">{customer.displayName}</strong>
                  <span className="text-[9px] font-mono text-slate-600">{customer.level.label}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-[8px] font-black uppercase text-orange-300">{customer.confirmedPurchases} compras</span>
                  <button
                    type="button"
                    onClick={() => openStoreCustomerChat({
                      perspective: 'store',
                      storeId,
                      customerId: customer.customerId,
                      customerName: customer.displayName,
                    })}
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-orange-500/25 bg-orange-500/10 text-orange-300 hover:bg-orange-500/15"
                    aria-label={`Conversar com ${customer.displayName}`}
                    title={`Conversar com ${customer.displayName}`}
                  >
                    <MessageSquareText className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
                <div className="rounded-xl bg-slate-900 p-2"><ShoppingBag className="mb-1 h-3.5 w-3.5 text-teal-400" />R$ {(customer.confirmedSpentMinor / 100).toFixed(2)}</div>
                <div className="rounded-xl bg-slate-900 p-2"><Coins className="mb-1 h-3.5 w-3.5 text-amber-400" />{customer.pointsBalance} pontos</div>
                <div className="rounded-xl bg-slate-900 p-2"><Award className="mb-1 h-3.5 w-3.5 text-violet-400" />{customer.completedChallenges} desafios</div>
                <div className="rounded-xl bg-slate-900 p-2"><Gift className="mb-1 h-3.5 w-3.5 text-emerald-400" />{customer.rewardRedemptions} resgates</div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
