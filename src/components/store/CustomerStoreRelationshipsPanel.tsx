import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BadgePercent,
  CalendarDays,
  CheckCircle2,
  Gift,
  ShoppingBag,
  Sparkles,
  Star,
  Store as StoreIcon,
  Target,
  Ticket,
  Trophy,
} from 'lucide-react';
import type { Order, Store } from '../../types';
import { auth } from '../../utils/firebase';
import {
  CustomerPersonalBenefitsGroup,
  CustomerPublicPromotionsGroupHeader,
} from './CustomerRelationshipBenefitGroups';
import {
  subscribeToPreferredPublicProducts,
  type PublicProduct,
} from '../../utils/publicProducts';
import {
  listMarketplacePromotions,
  type PublicMarketplacePromotion,
} from '../../utils/marketplaceCheckout';
import {
  getBuyerLoyaltyBalance,
  subscribeToStoreLoyaltyLedger,
} from '../../utils/loyaltyLedger';

type Props = {
  stores: Store[];
  orders: Order[];
  onEnterStore: (store: Store) => void;
};

type StoreRelationship = {
  store: Store;
  orders: Order[];
  purchaseCount: number;
  totalSpent: number;
  points: number;
  lastOrderAt: string;
};

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const validDate = (value: string): Date | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const completedOrder = (order: Order): boolean => order.status === 'delivered' || order.status === 'shipped';
const relationshipLevel = (points: number): { label: string; next: number } => {
  if (points >= 1500) return { label: 'Ouro', next: 2500 };
  if (points >= 500) return { label: 'Prata', next: 1500 };
  return { label: 'Bronze', next: 500 };
};
const discountedPrice = (product: PublicProduct, promotion: PublicMarketplacePromotion): number =>
  promotion.discountType === 'percentage'
    ? Math.max(0, product.price * (1 - promotion.discountValue / 100))
    : Math.max(0, product.price - promotion.discountValue);

export function CustomerStoreRelationshipsPanel({ stores, orders, onEnterStore }: Props) {
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [promotions, setPromotions] = useState<PublicMarketplacePromotion[]>([]);
  const [benefitsLoading, setBenefitsLoading] = useState(false);
  const [pointsByStoreId, setPointsByStoreId] = useState<Record<string, number>>({});

  const relationshipStoreIds = useMemo(() => {
    const publishedStoreIds = new Set(stores.map(store => store.id));
    return Array.from(new Set(orders.map(order => order.storeId?.trim() ?? '').filter(storeId => storeId && publishedStoreIds.has(storeId))));
  }, [orders, stores]);
  const relationshipStoreKey = useMemo(() => relationshipStoreIds.join('|'), [relationshipStoreIds]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || relationshipStoreIds.length === 0) {
      setPointsByStoreId({});
      return;
    }
    const unsubscribers = relationshipStoreIds.map(storeId =>
      subscribeToStoreLoyaltyLedger(
        storeId,
        events => setPointsByStoreId(current => ({
          ...current,
          [storeId]: getBuyerLoyaltyBalance(events, user.uid, user.email ?? ''),
        })),
        error => {
          console.warn('Relacionamento: ledger de fidelidade indisponível.', error);
          setPointsByStoreId(current => ({ ...current, [storeId]: 0 }));
        }
      )
    );
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [relationshipStoreKey]);

  const relationships = useMemo<StoreRelationship[]>(() => {
    const storesById = new Map(stores.map(store => [store.id, store]));
    const grouped = new Map<string, Order[]>();
    for (const order of orders) {
      const storeId = order.storeId?.trim() ?? '';
      if (!storeId || !storesById.has(storeId)) continue;
      grouped.set(storeId, [...(grouped.get(storeId) ?? []), order]);
    }
    return Array.from(grouped.entries()).map(([storeId, storeOrders]) => {
      const store = storesById.get(storeId)!;
      const eligibleOrders = storeOrders.filter(completedOrder);
      const totalSpent = eligibleOrders.reduce((sum, order) => sum + order.total, 0);
      const ordered = [...storeOrders].sort((left, right) => (validDate(right.createdAt)?.getTime() ?? 0) - (validDate(left.createdAt)?.getTime() ?? 0));
      return {
        store,
        orders: ordered,
        purchaseCount: eligibleOrders.length,
        totalSpent,
        points: pointsByStoreId[storeId] ?? 0,
        lastOrderAt: ordered[0]?.createdAt ?? '',
      };
    }).sort((left, right) => (validDate(right.lastOrderAt)?.getTime() ?? 0) - (validDate(left.lastOrderAt)?.getTime() ?? 0));
  }, [orders, pointsByStoreId, stores]);

  const selected = relationships.find(item => item.store.id === selectedStoreId) ?? null;

  useEffect(() => {
    if (!selected) {
      setProducts([]);
      setPromotions([]);
      return;
    }
    setBenefitsLoading(true);
    const unsubscribe = subscribeToPreferredPublicProducts(
      selected.store.id,
      result => { setProducts(result.products); setBenefitsLoading(false); },
      () => { setProducts([]); setBenefitsLoading(false); }
    );
    void listMarketplacePromotions(selected.store.id).then(setPromotions).catch(() => setPromotions([]));
    return unsubscribe;
  }, [selected?.store.id]);

  const activePromotions = useMemo(() => {
    const now = Date.now();
    return promotions.filter(promotion => {
      const end = validDate(promotion.endsAt)?.getTime() ?? 0;
      return end === 0 || end > now;
    });
  }, [promotions]);

  const promotedProducts = useMemo(() => products.flatMap(product => {
    const promotion = activePromotions.find(item => item.productIds.includes(product.id));
    return promotion ? [{ product, promotion }] : [];
  }), [activePromotions, products]);

  if (selected) {
    const level = relationshipLevel(selected.points);
    const progress = Math.min(100, Math.round((selected.points / level.next) * 100));

    return (
      <section className="space-y-4" id="customer-store-relationship-detail">
        <button type="button" onClick={() => setSelectedStoreId('')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-black uppercase text-slate-300">
          <ArrowLeft className="h-4 w-4" /> Minhas lojas
        </button>

        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-start gap-3">
            {selected.store.logo ? (
              <img src={selected.store.logo} alt={selected.store.name} className="h-12 w-12 shrink-0 rounded-2xl border border-slate-800 object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-orange-400"><StoreIcon className="h-5 w-5" /></div>
            )}
            <div className="min-w-0 flex-1">
              <span className="text-[8px] font-black uppercase tracking-[.16em] text-orange-400">Meu relacionamento</span>
              <h3 className="mt-1 truncate text-base font-black text-white">{selected.store.name}</h3>
              <p className="mt-1 text-[10px] text-slate-500">{selected.purchaseCount} compra(s) concluída(s) · {money.format(selected.totalSpent)} em compras</p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-3">
            <div className="flex items-center gap-2 text-amber-300"><Trophy className="h-4 w-4" /><span className="text-[9px] font-black uppercase">{level.label}</span></div>
            <strong className="mt-2 block text-lg font-black text-white">{selected.points} pts</strong>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-amber-400" style={{ width: `${progress}%` }} /></div>
            <span className="mt-1 block text-[8px] text-slate-500">{Math.max(0, level.next - selected.points)} pts até o próximo marco</span>
          </div>
        </div>

        <CustomerPersonalBenefitsGroup storeId={selected.store.id} />
        <CustomerPublicPromotionsGroupHeader />

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-emerald-300"><Ticket className="h-4 w-4" /><h4 className="text-xs font-black uppercase text-white">Cupons públicos</h4></div><p className="mt-1 text-[9px] text-slate-500">Campanhas promocionais publicadas pela loja para a vitrine.</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[8px] font-black text-emerald-300">{activePromotions.length}</span></div>
          <div className="mt-3 space-y-2">
            {activePromotions.length > 0 ? activePromotions.map(promotion => (
              <article key={promotion.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block text-xs text-white">{promotion.title}</strong><span className="mt-1 block font-mono text-[9px] font-black text-emerald-300">CÓDIGO: {promotion.code}</span></div><span className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[8px] font-black text-emerald-300">{promotion.badge}</span></div>
                {validDate(promotion.endsAt) && <span className="mt-2 flex items-center gap-1 text-[8px] text-slate-500"><CalendarDays className="h-3 w-3" /> válido até {shortDate.format(validDate(promotion.endsAt)!)}</span>}
              </article>
            )) : <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-3 py-5 text-center text-[10px] text-slate-500">Nenhum cupom público disponível agora.</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-orange-300"><BadgePercent className="h-4 w-4" /><h4 className="text-xs font-black uppercase text-white">Produtos em promoção</h4></div>
          <p className="mt-1 text-[9px] text-slate-500">Preços promocionais publicados na vitrine da loja e disponíveis publicamente.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {promotedProducts.length > 0 ? promotedProducts.map(({ product, promotion }) => (
              <article key={`${promotion.id}-${product.id}`} className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
                <div className="aspect-square bg-slate-900">{product.image ? <img src={product.image} alt={product.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <div className="flex h-full items-center justify-center text-slate-700"><Gift className="h-7 w-7" /></div>}</div>
                <div className="p-3"><span className="rounded-full border border-orange-400/20 bg-orange-400/10 px-2 py-1 text-[8px] font-black text-orange-300">{promotion.badge}</span><h5 className="mt-2 line-clamp-2 text-[10px] font-black text-white">{product.name}</h5><div className="mt-2"><span className="block text-[8px] text-slate-600 line-through">{money.format(product.price)}</span><strong className="text-[11px] text-emerald-400">{money.format(discountedPrice(product, promotion))}</strong></div></div>
              </article>
            )) : <div className="col-span-2 rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-3 py-5 text-center text-[10px] text-slate-500">{benefitsLoading ? 'Carregando ofertas da vitrine…' : 'Nenhum produto em promoção agora.'}</div>}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2 text-blue-300"><ShoppingBag className="h-4 w-4" /><h4 className="text-xs font-black uppercase text-white">Histórico de compras</h4></div>
          <div className="mt-3 space-y-2">{selected.orders.map(order => {
            const createdAt = validDate(order.createdAt);
            return <article key={order.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block truncate text-[10px] text-white">{order.items.map(item => `${item.quantity}× ${item.name}`).join(' · ')}</strong><span className="mt-1 block text-[8px] text-slate-500">{createdAt ? shortDate.format(createdAt) : 'Data indisponível'}</span></div><strong className="shrink-0 text-[10px] text-emerald-400">{money.format(order.total)}</strong></div></article>;
          })}</div>
        </section>

        <button type="button" onClick={() => onEnterStore(selected.store)} className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-xs font-black uppercase text-slate-950">Entrar na loja</button>
      </section>
    );
  }

  return (
    <section className="space-y-4" id="customer-store-relationships">
      <div className="rounded-3xl border border-orange-500/20 bg-orange-500/5 p-4">
        <div className="flex items-center gap-2 text-orange-300"><Sparkles className="h-4 w-4" /><span className="text-[9px] font-black uppercase tracking-[.16em]">Minhas lojas</span></div>
        <h3 className="mt-1 text-base font-black text-white">Seu relacionamento com cada loja</h3>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">Compras, pontos de relacionamento, desafios, cupons e ofertas das lojas onde você já comprou.</p>
      </div>
      {relationships.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {relationships.map(item => {
            const level = relationshipLevel(item.points);
            const last = validDate(item.lastOrderAt);
            return (
              <button key={item.store.id} type="button" onClick={() => setSelectedStoreId(item.store.id)} className="min-w-0 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-left transition-colors hover:border-orange-500/30">
                <div className="aspect-[4/3] bg-slate-950">{item.store.banner || item.store.logo ? <img src={item.store.banner || item.store.logo} alt={item.store.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <div className="flex h-full items-center justify-center text-slate-700"><StoreIcon className="h-8 w-8" /></div>}</div>
                <div className="space-y-3 p-3">
                  <div><h4 className="truncate text-xs font-black uppercase text-white">{item.store.name}</h4><span className="mt-1 block text-[8px] text-slate-500">{item.purchaseCount} compra(s){last ? ` · última ${shortDate.format(last)}` : ''}</span></div>
                  <div className="grid grid-cols-2 gap-1.5"><div className="rounded-xl border border-amber-400/15 bg-amber-400/5 p-2"><Star className="h-3 w-3 text-amber-300" /><strong className="mt-1 block text-[9px] text-white">{item.points} pts</strong><span className="text-[7px] uppercase text-slate-600">{level.label}</span></div><div className="rounded-xl border border-teal-400/15 bg-teal-400/5 p-2"><Target className="h-3 w-3 text-teal-300" /><strong className="mt-1 block text-[9px] text-white">Ver</strong><span className="text-[7px] uppercase text-slate-600">Desafios</span></div></div>
                  <span className="flex items-center gap-1 text-[8px] font-black uppercase text-orange-300"><CheckCircle2 className="h-3 w-3" /> Meu relacionamento →</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/50 px-5 py-10 text-center"><ShoppingBag className="mx-auto h-8 w-8 text-slate-700" /><h4 className="mt-3 text-xs font-black uppercase text-slate-400">Sua história começa na primeira compra</h4><p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-slate-600">Quando você concluir uma compra em uma loja do Kyrub, ela aparecerá aqui com histórico e benefícios.</p></div>
      )}
    </section>
  );
}
