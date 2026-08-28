import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgePercent, Coins, Gift, Target } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  persistProductLoyaltyPoints,
  subscribeToProductLoyalty,
  type ProductLoyaltyMap,
} from '../../utils/productLoyalty';
import {
  subscribeToPreferredPublicProducts,
  type PublicProduct,
} from '../../utils/publicProducts';

type Tab = 'coupons' | 'points' | 'challenges' | 'rewards';

export function LoyaltyPromotionCenterBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [tab, setTab] = useState<Tab>('points');
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [rules, setRules] = useState<ProductLoyaltyMap>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setProducts([]);
      setRules({});
      return;
    }
    const unsubscribeProducts = subscribeToPreferredPublicProducts(
      user.uid,
      result => setProducts(result.products),
      () => setProducts([])
    );
    const unsubscribeRules = subscribeToProductLoyalty(
      user.uid,
      next => setRules(next),
      () => setRules({})
    );
    return () => {
      unsubscribeProducts();
      unsubscribeRules();
    };
  }, [user?.uid]);

  useEffect(() => {
    setDrafts(current => {
      const next = { ...current };
      products.forEach(product => {
        if (!(product.id in next)) next[product.id] = String(rules[product.id] ?? 0);
      });
      return next;
    });
  }, [products, rules]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let currentHost: HTMLDivElement | null = null;
    const synchronize = () => {
      if (cancelled) return;
      const root = document.getElementById('erp-gerencial-tab');
      if (!root) {
        timer = window.setTimeout(synchronize, 100);
        return;
      }

      const headings = Array.from(root.querySelectorAll('h4'));
      headings.forEach(heading => {
        const text = heading.textContent?.trim().toLocaleUpperCase('pt-BR') ?? '';
        if (text === 'CUPONS & VOUCHERS') heading.textContent = 'FIDELIDADE & PROMOÇÕES';
      });
      const paragraphs = Array.from(root.querySelectorAll('p'));
      paragraphs.forEach(paragraph => {
        if (paragraph.textContent?.includes('Campanhas de marketing e cupons de desconto')) {
          paragraph.textContent = 'Pontos, cupons, desafios, recompensas e campanhas para fidelizar clientes.';
        }
      });

      const vouchersHeading = headings.find(heading =>
        heading.textContent?.trim().toLocaleUpperCase('pt-BR') === 'CRIAR NOVO CUPOM'
      );
      const container = vouchersHeading?.closest('.grid');
      if (container instanceof HTMLElement && (!currentHost || !currentHost.isConnected)) {
        currentHost = document.createElement('div');
        currentHost.id = 'kyrub-loyalty-promotion-center-host';
        currentHost.className = 'lg:col-span-2';
        container.insertBefore(currentHost, container.firstChild);
        setHost(currentHost);
      }
      if (!container && currentHost) {
        currentHost.remove();
        currentHost = null;
        setHost(null);
      }
      timer = window.setTimeout(synchronize, 120);
    };
    synchronize();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      currentHost?.remove();
      setHost(null);
    };
  }, []);

  const configuredCount = useMemo(
    () => products.filter(product => (rules[product.id] ?? 0) > 0).length,
    [products, rules]
  );

  const savePoints = async (product: PublicProduct) => {
    if (!user || busyId) return;
    const parsed = Math.max(0, Math.floor(Number(drafts[product.id]) || 0));
    setBusyId(product.id);
    setMessage('');
    try {
      await persistProductLoyaltyPoints(user, product.id, parsed);
      setMessage(`${product.name}: ${parsed} ponto(s) por unidade.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível salvar os pontos.');
    } finally {
      setBusyId('');
    }
  };

  if (!host) return null;

  return createPortal(
    <section className="mb-5 rounded-3xl border border-amber-500/20 bg-slate-900 p-4 sm:p-5" id="loyalty-promotion-center">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[9px] font-black uppercase tracking-[.16em] text-amber-400">Relacionamento comercial</span>
          <h3 className="mt-1 text-sm font-black uppercase text-white">Fidelidade & Promoções</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">A pontuação-base pertence ao produto. Esta central organiza as regras e, depois, aplica campanhas e recompensas sobre elas.</p>
        </div>
        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[8px] font-black text-amber-300">{configuredCount}/{products.length} com pontos</span>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        {([
          ['coupons', 'Cupons', BadgePercent],
          ['points', 'Pontos', Coins],
          ['challenges', 'Desafios', Target],
          ['rewards', 'Recompensas', Gift],
        ] as const).map(([value, label, Icon]) => (
          <button key={value} type="button" onClick={() => setTab(value)} className={`min-w-0 rounded-xl border px-2 py-2 text-[8px] font-black uppercase ${tab === value ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : 'border-slate-800 bg-slate-950 text-slate-500'}`}>
            <Icon className="mx-auto mb-1 h-3.5 w-3.5" />
            <span className="block truncate">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'points' && (
        <div className="mt-4 space-y-2">
          {products.map(product => (
            <div key={product.id} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-[10px] text-white">{product.name}</strong>
                <span className="text-[8px] text-slate-500">{product.category}</span>
              </div>
              <input type="number" min="0" step="1" value={drafts[product.id] ?? String(rules[product.id] ?? 0)} onChange={event => setDrafts(current => ({ ...current, [product.id]: event.target.value }))} className="w-20 rounded-xl border border-slate-800 bg-slate-900 px-2 py-2 text-center text-xs font-black text-amber-300" aria-label={`Pontos de ${product.name}`} />
              <button type="button" disabled={busyId === product.id} onClick={() => void savePoints(product)} className="rounded-xl bg-amber-500 px-3 py-2 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40">Salvar</button>
            </div>
          ))}
          {products.length === 0 && <p className="rounded-2xl border border-dashed border-slate-800 p-5 text-center text-xs text-slate-500">Publique produtos para configurar a pontuação-base.</p>}
        </div>
      )}

      {tab === 'coupons' && <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-[10px] text-slate-400">Os cupons canônicos continuam logo abaixo. Eles alteram preço/benefício temporariamente, sem mudar os pontos-base do produto.</p>}
      {tab === 'challenges' && <p className="mt-4 rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-4 text-[10px] text-slate-400">Área preparada para metas como “3 compras no mês”, “compre itens de 3 categorias” e bônus de recorrência. As regras serão persistidas em uma etapa própria.</p>}
      {tab === 'rewards' && <p className="mt-4 rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-4 text-[10px] text-slate-400">Área preparada para trocar pontos por benefícios, produtos, descontos ou vantagens da loja sem misturar pontos com saldo financeiro.</p>}

      {message && <p className="mt-3 text-[9px] font-bold text-amber-200">{message}</p>}
    </section>,
    host
  );
}
