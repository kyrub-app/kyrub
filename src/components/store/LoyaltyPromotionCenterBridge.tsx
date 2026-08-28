import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgePercent, Coins, Gift, Plus, Target, Trash2 } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  persistProductLoyaltyPoints,
  subscribeToProductLoyalty,
  type ProductLoyaltyMap,
} from '../../utils/productLoyalty';
import {
  deleteLoyaltyChallenge,
  saveLoyaltyChallenge,
  setLoyaltyChallengeActive,
  subscribeToLoyaltyChallenges,
  type LoyaltyChallenge,
  type LoyaltyChallengeMetric,
} from '../../utils/loyaltyChallenges';
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
  const [challenges, setChallenges] = useState<LoyaltyChallenge[]>([]);
  const [challengeTitle, setChallengeTitle] = useState('');
  const [challengeDescription, setChallengeDescription] = useState('');
  const [challengeMetric, setChallengeMetric] = useState<LoyaltyChallengeMetric>('paid_orders');
  const [challengeTarget, setChallengeTarget] = useState('3');
  const [challengeRewardPoints, setChallengeRewardPoints] = useState('0');
  const [challengeStartsAt, setChallengeStartsAt] = useState('');
  const [challengeEndsAt, setChallengeEndsAt] = useState('');
  const [editingChallengeId, setEditingChallengeId] = useState('');
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setProducts([]); setRules({}); setChallenges([]);
      return;
    }
    const unsubscribeProducts = subscribeToPreferredPublicProducts(user.uid, result => setProducts(result.products), () => setProducts([]));
    const unsubscribeRules = subscribeToProductLoyalty(user.uid, setRules, () => setRules({}));
    const unsubscribeChallenges = subscribeToLoyaltyChallenges(user.uid, setChallenges, () => setChallenges([]));
    return () => { unsubscribeProducts(); unsubscribeRules(); unsubscribeChallenges(); };
  }, [user?.uid]);

  useEffect(() => {
    setDrafts(current => {
      const next = { ...current };
      products.forEach(product => { if (!(product.id in next)) next[product.id] = String(rules[product.id] ?? 0); });
      return next;
    });
  }, [products, rules]);

  useEffect(() => {
    let cancelled = false; let timer = 0; let currentHost: HTMLDivElement | null = null;
    const synchronize = () => {
      if (cancelled) return;
      const root = document.getElementById('erp-gerencial-tab');
      if (!root) { timer = window.setTimeout(synchronize, 100); return; }
      const headings = Array.from(root.querySelectorAll('h4'));
      headings.forEach(heading => { if ((heading.textContent?.trim().toLocaleUpperCase('pt-BR') ?? '') === 'CUPONS & VOUCHERS') heading.textContent = 'FIDELIDADE & PROMOÇÕES'; });
      Array.from(root.querySelectorAll('p')).forEach(paragraph => { if (paragraph.textContent?.includes('Campanhas de marketing e cupons de desconto')) paragraph.textContent = 'Pontos, cupons, desafios, recompensas e campanhas para fidelizar clientes.'; });
      const vouchersHeading = headings.find(heading => heading.textContent?.trim().toLocaleUpperCase('pt-BR') === 'CRIAR NOVO CUPOM');
      const container = vouchersHeading?.closest('.grid');
      if (container instanceof HTMLElement && (!currentHost || !currentHost.isConnected)) {
        currentHost = document.createElement('div'); currentHost.id = 'kyrub-loyalty-promotion-center-host'; currentHost.className = 'lg:col-span-2'; container.insertBefore(currentHost, container.firstChild); setHost(currentHost);
      }
      if (!container && currentHost) { currentHost.remove(); currentHost = null; setHost(null); }
      timer = window.setTimeout(synchronize, 120);
    };
    synchronize();
    return () => { cancelled = true; window.clearTimeout(timer); currentHost?.remove(); setHost(null); };
  }, []);

  const configuredCount = useMemo(() => products.filter(product => (rules[product.id] ?? 0) > 0).length, [products, rules]);

  const savePoints = async (product: PublicProduct) => {
    if (!user || busyId) return;
    const parsed = Math.max(0, Math.floor(Number(drafts[product.id]) || 0));
    setBusyId(product.id); setMessage('');
    try { await persistProductLoyaltyPoints(user, product.id, parsed); setMessage(`${product.name}: ${parsed} ponto(s) por unidade.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível salvar os pontos.'); }
    finally { setBusyId(''); }
  };

  const resetChallengeForm = () => {
    setEditingChallengeId(''); setChallengeTitle(''); setChallengeDescription(''); setChallengeMetric('paid_orders'); setChallengeTarget('3'); setChallengeRewardPoints('0'); setChallengeStartsAt(''); setChallengeEndsAt('');
  };

  const editChallenge = (challenge: LoyaltyChallenge) => {
    setEditingChallengeId(challenge.id); setChallengeTitle(challenge.title); setChallengeDescription(challenge.description); setChallengeMetric(challenge.metric); setChallengeTarget(String(challenge.target)); setChallengeRewardPoints(String(challenge.rewardPoints)); setChallengeStartsAt(challenge.startsAt); setChallengeEndsAt(challenge.endsAt);
  };

  const persistChallenge = async () => {
    if (!user || busyId) return;
    setBusyId('challenge-save'); setMessage('');
    try {
      await saveLoyaltyChallenge(user, {
        title: challengeTitle, description: challengeDescription, metric: challengeMetric,
        target: Math.max(1, Math.floor(Number(challengeTarget) || 1)), rewardPoints: Math.max(0, Math.floor(Number(challengeRewardPoints) || 0)),
        startsAt: challengeStartsAt, endsAt: challengeEndsAt, active: true,
      }, editingChallengeId);
      setMessage(editingChallengeId ? 'Desafio atualizado.' : 'Desafio criado.'); resetChallengeForm();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível salvar o desafio.'); }
    finally { setBusyId(''); }
  };

  if (!host) return null;

  return createPortal(
    <section className="mb-5 rounded-3xl border border-amber-500/20 bg-slate-900 p-4 sm:p-5" id="loyalty-promotion-center">
      <div className="flex items-start justify-between gap-3"><div><span className="text-[9px] font-black uppercase tracking-[.16em] text-amber-400">Relacionamento comercial</span><h3 className="mt-1 text-sm font-black uppercase text-white">Fidelidade & Promoções</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-500">A pontuação-base pertence ao produto. Esta central organiza regras, desafios e recompensas sobre a mesma fonte canônica.</p></div><span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[8px] font-black text-amber-300">{configuredCount}/{products.length} com pontos</span></div>
      <div className="mt-4 grid grid-cols-4 gap-2">{([['coupons','Cupons',BadgePercent],['points','Pontos',Coins],['challenges','Desafios',Target],['rewards','Recompensas',Gift]] as const).map(([value,label,Icon]) => <button key={value} type="button" onClick={() => setTab(value)} className={`min-w-0 rounded-xl border px-2 py-2 text-[8px] font-black uppercase ${tab===value?'border-amber-400/40 bg-amber-400/10 text-amber-300':'border-slate-800 bg-slate-950 text-slate-500'}`}><Icon className="mx-auto mb-1 h-3.5 w-3.5"/><span className="block truncate">{label}</span></button>)}</div>

      {tab === 'points' && <div className="mt-4 space-y-2">{products.map(product => <div key={product.id} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3"><div className="min-w-0 flex-1"><strong className="block truncate text-[10px] text-white">{product.name}</strong><span className="text-[8px] text-slate-500">{product.category}</span></div><input type="number" min="0" step="1" value={drafts[product.id] ?? String(rules[product.id] ?? 0)} onChange={event => setDrafts(current => ({...current,[product.id]:event.target.value}))} className="w-20 rounded-xl border border-slate-800 bg-slate-900 px-2 py-2 text-center text-xs font-black text-amber-300"/><button type="button" disabled={busyId===product.id} onClick={() => void savePoints(product)} className="rounded-xl bg-amber-500 px-3 py-2 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40">Salvar</button></div>)}{products.length===0&&<p className="rounded-2xl border border-dashed border-slate-800 p-5 text-center text-xs text-slate-500">Publique produtos para configurar a pontuação-base.</p>}</div>}

      {tab === 'coupons' && <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-[10px] text-slate-400">Os cupons canônicos continuam logo abaixo. Eles alteram preço/benefício temporariamente, sem mudar os pontos-base do produto.</p>}

      {tab === 'challenges' && <div className="mt-4 space-y-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-center gap-2 text-teal-300"><Plus className="h-4 w-4"/><strong className="text-[10px] uppercase">{editingChallengeId?'Editar desafio':'Novo desafio'}</strong></div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input value={challengeTitle} onChange={e=>setChallengeTitle(e.target.value)} placeholder="Nome do desafio" className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white"/>
            <select value={challengeMetric} onChange={e=>setChallengeMetric(e.target.value as LoyaltyChallengeMetric)} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white"><option value="paid_orders">Compras pagas</option><option value="points_earned">Pontos conquistados</option></select>
            <input type="number" min="1" value={challengeTarget} onChange={e=>setChallengeTarget(e.target.value)} placeholder="Meta" className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white"/>
            <input type="number" min="0" value={challengeRewardPoints} onChange={e=>setChallengeRewardPoints(e.target.value)} placeholder="Bônus em pontos" className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white"/>
            <input type="date" value={challengeStartsAt} onChange={e=>setChallengeStartsAt(e.target.value)} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white"/>
            <input type="date" value={challengeEndsAt} onChange={e=>setChallengeEndsAt(e.target.value)} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white"/>
          </div>
          <textarea value={challengeDescription} onChange={e=>setChallengeDescription(e.target.value)} placeholder="Descrição para o cliente" className="mt-2 min-h-16 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white"/>
          <div className="mt-2 flex gap-2"><button type="button" onClick={() => void persistChallenge()} disabled={busyId==='challenge-save'} className="rounded-xl bg-teal-400 px-3 py-2 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40">{editingChallengeId?'Salvar alterações':'Criar desafio'}</button>{editingChallengeId&&<button type="button" onClick={resetChallengeForm} className="rounded-xl border border-slate-700 px-3 py-2 text-[8px] font-black uppercase text-slate-400">Cancelar</button>}</div>
        </div>
        <div className="space-y-2">{challenges.map(challenge => <article key={challenge.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block truncate text-[10px] text-white">{challenge.title}</strong><span className="mt-1 block text-[8px] text-slate-500">Meta: {challenge.target} {challenge.metric==='paid_orders'?'compra(s) paga(s)':'ponto(s)'}{challenge.rewardPoints>0?` · bônus ${challenge.rewardPoints} pts`:''}</span></div><button type="button" onClick={() => user && void setLoyaltyChallengeActive(user,challenge,!challenge.active)} className={`rounded-full border px-2 py-1 text-[7px] font-black uppercase ${challenge.active?'border-emerald-400/30 bg-emerald-400/10 text-emerald-300':'border-slate-700 text-slate-500'}`}>{challenge.active?'Ativo':'Pausado'}</button></div>{challenge.description&&<p className="mt-2 text-[9px] text-slate-500">{challenge.description}</p>}<div className="mt-3 flex gap-2"><button type="button" onClick={()=>editChallenge(challenge)} className="rounded-lg border border-slate-700 px-2 py-1.5 text-[7px] font-black uppercase text-slate-400">Editar</button><button type="button" onClick={() => user && window.confirm(`Excluir ${challenge.title}?`) && void deleteLoyaltyChallenge(user,challenge)} className="rounded-lg border border-red-500/20 px-2 py-1.5 text-[7px] font-black uppercase text-red-300"><Trash2 className="inline h-3 w-3"/> Excluir</button></div></article>)}{challenges.length===0&&<p className="rounded-2xl border border-dashed border-slate-800 p-5 text-center text-[10px] text-slate-500">Nenhum desafio criado ainda.</p>}</div>
      </div>}

      {tab === 'rewards' && <p className="mt-4 rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-4 text-[10px] text-slate-400">Área preparada para trocar pontos por benefícios, produtos, descontos ou vantagens da loja sem misturar pontos com saldo financeiro.</p>}
      {message && <p className="mt-3 text-[9px] font-bold text-amber-200">{message}</p>}
    </section>, host
  );
}
