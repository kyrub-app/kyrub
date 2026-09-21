import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Award, BadgePercent, Gift, LoaderCircle, Save, Target } from 'lucide-react';
import { normalizeStorePointsPerUnit } from '../../../shared/storePoints';
import { auth } from '../../utils/firebase';
import { persistPublicProduct, subscribeToPreferredPublicProducts, type PublicProduct } from '../../utils/publicProducts';
import { StorePromotionsManager } from '../StorePromotionsManager';
import { StoreChallengeManager } from './StoreChallengeManager';
import { StoreRewardManager } from './StoreRewardManager';

type PromotionalTab = 'coupons' | 'points' | 'challenges' | 'rewards';
type DraftMap = Record<string, string>;

const parsePoints = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  try { return normalizeStorePointsPerUnit(Number(value)); } catch { return null; }
};

export function PromotionalDirectRuntime() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [activeTab, setActiveTab] = useState<PromotionalTab>('coupons');
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [busyProductId, setBusyProductId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    if (!user) { setProducts([]); setDrafts({}); return; }
    return subscribeToPreferredPublicProducts(user.uid, result => {
      setProducts(result.products);
      setDrafts(current => Object.fromEntries(result.products.map(product => [product.id, current[product.id] ?? String(product.storePointsPerUnit ?? 0)])));
    }, () => { setProducts([]); setDrafts({}); });
  }, [user?.uid]);

  const configuredCount = useMemo(() => products.filter(product => (product.storePointsPerUnit ?? 0) > 0).length, [products]);
  const savePoints = async (product: PublicProduct) => {
    if (!user || busyProductId) return;
    const points = parsePoints(drafts[product.id] ?? '0');
    if (points === null) { setMessage('Informe uma quantidade inteira de pontos igual ou maior que zero.'); return; }
    setBusyProductId(product.id); setMessage('');
    try {
      await persistPublicProduct(user, { ...product, storePointsPerUnit: points, updatedAt: new Date().toISOString() });
      setMessage(`${product.name}: ${points} ponto${points === 1 ? '' : 's'} por unidade.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível salvar a pontuação deste item.'); }
    finally { setBusyProductId(''); }
  };

  if (!user) return <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-xs text-slate-400">Faça login novamente para gerenciar os promocionais da loja.</div>;

  const tabs: Array<{ id: PromotionalTab; label: string; icon: ComponentType<{ className?: string }> }> = [
    { id: 'coupons', label: 'Cupons', icon: BadgePercent }, { id: 'points', label: 'Pontos', icon: Award },
    { id: 'challenges', label: 'Desafios', icon: Target }, { id: 'rewards', label: 'Recompensas', icon: Gift },
  ];

  return <div id="kyrub-promocionais-direct-runtime" data-kyrub-promocionais-native="true" className="space-y-4">
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-400">Promocionais</span><h3 className="mt-1 text-base font-black text-white">Benefícios da sua loja</h3></div>{products.length > 0 && <span className="text-[10px] font-bold text-slate-500">{configuredCount}/{products.length} itens pontuando</span>}</div>
      <nav className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Áreas promocionais">{tabs.map(tab => { const Icon = tab.icon; const active = activeTab === tab.id; return <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); setMessage(''); }} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[10px] font-black uppercase ${active ? 'border-amber-500/50 bg-amber-500/10 text-amber-200' : 'border-slate-800 bg-slate-950 text-slate-500'}`}><Icon className="h-3.5 w-3.5" />{tab.label}</button>; })}</nav>
    </section>
    {activeTab === 'coupons' && <StorePromotionsManager storeId={user.uid} products={products} triggerToast={next => setMessage(next)} />}
    {activeTab === 'points' && <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5"><h4 className="text-sm font-black uppercase text-white">Pontos por produto</h4><p className="mt-1 text-[10px] text-slate-500">O valor vigente é congelado no pedido e o ledger credita quantidade × pontos por unidade.</p><div className="mt-4 space-y-2">{products.map(product => { const draft = drafts[product.id] ?? String(product.storePointsPerUnit ?? 0); const parsed = parsePoints(draft); const changed = parsed !== null && parsed !== (product.storePointsPerUnit ?? 0); return <div key={product.id} className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center"><strong className="truncate text-xs text-white">{product.name}</strong><input type="number" min="0" step="1" value={draft} disabled={Boolean(busyProductId)} onChange={event => setDrafts(current => ({ ...current, [product.id]: event.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-black text-amber-200"/><button type="button" disabled={!changed || Boolean(busyProductId)} onClick={() => void savePoints(product)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 text-[9px] font-black uppercase text-amber-200 disabled:opacity-35">{busyProductId === product.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Salvar</button></div>; })}</div></section>}
    {activeTab === 'challenges' && <StoreChallengeManager />}
    {activeTab === 'rewards' && <StoreRewardManager products={products} />}
    {message && <div className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-[10px] font-bold text-slate-300">{message}</div>}
  </div>;
}
