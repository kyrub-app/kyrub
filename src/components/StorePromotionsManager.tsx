import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Product } from '../types';
import type { StorePromotion, StorePromotionDiscountType } from '../utils/storePromotions';
import { auth } from '../utils/firebase';

type ToastType = 'success' | 'error' | 'info';
type Draft = {
  id?: string;
  code: string;
  title: string;
  badge: string;
  discountType: StorePromotionDiscountType;
  discountValue: string;
  productIds: string[];
  startsAt: string;
  endsAt: string;
  maxRedemptions: string;
  maxRedemptionsPerBuyer: string;
  active: boolean;
};

type PromotionApiPayload = { promotions?: StorePromotion[]; error?: string };

const localInput = (date: Date): string => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
};

const emptyDraft = (): Draft => {
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    code: '', title: '', badge: '', discountType: 'percentage', discountValue: '', productIds: [],
    startsAt: localInput(start), endsAt: localInput(end), maxRedemptions: '0', maxRedemptionsPerBuyer: '0', active: true,
  };
};

const fromPromotion = (promotion: StorePromotion): Draft => ({
  id: promotion.id,
  code: promotion.code,
  title: promotion.title,
  badge: promotion.badge,
  discountType: promotion.discountType,
  discountValue: String(promotion.discountValue),
  productIds: promotion.productIds,
  startsAt: localInput(new Date(promotion.startsAt)),
  endsAt: localInput(new Date(promotion.endsAt)),
  maxRedemptions: String(promotion.maxRedemptions),
  maxRedemptionsPerBuyer: String(promotion.maxRedemptionsPerBuyer),
  active: promotion.active,
});

async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  return fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

async function readPromotionApiPayload(response: Response, fallbackMessage: string): Promise<PromotionApiPayload> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const raw = await response.text();

  if (!contentType.includes('application/json')) {
    console.error('[StorePromotionsManager] Promotions API returned non-JSON response.', {
      status: response.status,
      contentType,
      bodyPreview: raw.slice(0, 160),
    });
    throw new Error(fallbackMessage);
  }

  try {
    return raw ? JSON.parse(raw) as PromotionApiPayload : {};
  } catch (error) {
    console.error('[StorePromotionsManager] Promotions API returned invalid JSON.', {
      status: response.status,
      contentType,
      error,
    });
    throw new Error(fallbackMessage);
  }
}

export function StorePromotionsManager({
  storeId,
  products,
  triggerToast,
}: {
  storeId: string;
  products: Product[];
  triggerToast: (message: string, type?: ToastType) => void;
}) {
  const [promotions, setPromotions] = useState<StorePromotion[]>([]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const storeProducts = useMemo(
    () => products.filter(product => product.supplierId === storeId && product.wholesalePrice === undefined),
    [products, storeId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authorizedFetch(`/api/store-promotions?storeId=${encodeURIComponent(storeId)}`);
      const payload = await readPromotionApiPayload(response, 'Não foi possível carregar os cupons agora. Tente novamente em instantes.');
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os cupons.');
      setPromotions(payload.promotions ?? []);
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível carregar os cupons.', 'error');
    } finally {
      setLoading(false);
    }
  }, [storeId, triggerToast]);

  useEffect(() => { void load(); }, [load]);

  const reset = () => { setDraft(emptyDraft()); setShowForm(false); };

  const save = async () => {
    if (!draft.code.trim() || !draft.title.trim() || !draft.productIds.length || !draft.discountValue) {
      triggerToast('Informe código, título, desconto e pelo menos um produto.', 'error');
      return;
    }
    setBusy(true);
    try {
      const body = {
        storeId,
        code: draft.code,
        title: draft.title,
        badge: draft.badge,
        discountType: draft.discountType,
        discountValue: Number(draft.discountValue),
        productIds: draft.productIds,
        startsAt: new Date(draft.startsAt).toISOString(),
        endsAt: new Date(draft.endsAt).toISOString(),
        maxRedemptions: Number(draft.maxRedemptions || 0),
        maxRedemptionsPerBuyer: Number(draft.maxRedemptionsPerBuyer || 0),
        active: draft.active,
      };
      const url = draft.id ? `/api/store-promotions/${encodeURIComponent(draft.id)}` : '/api/store-promotions';
      const response = await authorizedFetch(url, { method: draft.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      const payload = await readPromotionApiPayload(response, 'Não foi possível salvar o cupom agora. Tente novamente em instantes.');
      if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar o cupom.');
      triggerToast(draft.id ? 'Cupom atualizado.' : 'Cupom criado.', 'success');
      reset();
      await load();
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível salvar o cupom.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (promotion: StorePromotion) => {
    setBusy(true);
    try {
      const response = await authorizedFetch(`/api/store-promotions/${encodeURIComponent(promotion.id)}/active`, {
        method: 'PATCH', body: JSON.stringify({ storeId, active: !promotion.active }),
      });
      const payload = await readPromotionApiPayload(response, 'Não foi possível alterar o cupom agora. Tente novamente em instantes.');
      if (!response.ok) throw new Error(payload.error || 'Não foi possível alterar o cupom.');
      setPromotions(current => current.map(item => item.id === promotion.id ? { ...item, active: !promotion.active } : item));
      triggerToast(!promotion.active ? 'Cupom ativado.' : 'Cupom pausado.', 'success');
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível alterar o cupom.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-5 text-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-300">Cupons & Vouchers</span>
          <h3 className="mt-1 text-base font-black">Promoções da loja</h3>
          <p className="mt-1 text-[10px] text-slate-400">Crie e administre benefícios que o checkout valida no servidor.</p>
        </div>
        <button type="button" onClick={() => { setDraft(emptyDraft()); setShowForm(true); }} className="min-h-10 rounded-xl bg-orange-500 px-4 text-[9px] font-black uppercase text-slate-950">Novo cupom</button>
      </div>

      {showForm && (
        <div className="space-y-4 rounded-2xl border border-slate-700 bg-slate-950 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[9px] font-black uppercase text-slate-400">Código<input value={draft.code} onChange={event => setDraft(value => ({ ...value, code: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-white" placeholder="EX.: CLIENTE10" /></label>
            <label className="text-[9px] font-black uppercase text-slate-400">Título<input value={draft.title} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-white" placeholder="Desconto de boas-vindas" /></label>
            <label className="text-[9px] font-black uppercase text-slate-400">Tipo<select value={draft.discountType} onChange={event => setDraft(value => ({ ...value, discountType: event.target.value as StorePromotionDiscountType }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs"><option value="percentage">Percentual (%)</option><option value="fixed">Valor fixo (R$)</option></select></label>
            <label className="text-[9px] font-black uppercase text-slate-400">Desconto<input type="number" min="0.01" step="0.01" value={draft.discountValue} onChange={event => setDraft(value => ({ ...value, discountValue: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs" /></label>
            <label className="text-[9px] font-black uppercase text-slate-400">Início<input type="datetime-local" value={draft.startsAt} onChange={event => setDraft(value => ({ ...value, startsAt: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs" /></label>
            <label className="text-[9px] font-black uppercase text-slate-400">Fim<input type="datetime-local" value={draft.endsAt} onChange={event => setDraft(value => ({ ...value, endsAt: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs" /></label>
            <label className="text-[9px] font-black uppercase text-slate-400">Limite total <span className="normal-case font-normal">(0 = sem limite)</span><input type="number" min="0" step="1" value={draft.maxRedemptions} onChange={event => setDraft(value => ({ ...value, maxRedemptions: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs" /></label>
            <label className="text-[9px] font-black uppercase text-slate-400">Por cliente <span className="normal-case font-normal">(0 = sem limite)</span><input type="number" min="0" step="1" value={draft.maxRedemptionsPerBuyer} onChange={event => setDraft(value => ({ ...value, maxRedemptionsPerBuyer: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs" /></label>
          </div>
          <div>
            <span className="text-[9px] font-black uppercase text-slate-400">Produtos participantes</span>
            <div className="mt-2 grid max-h-52 gap-2 overflow-auto sm:grid-cols-2">
              {storeProducts.map(product => <label key={product.id} className="flex items-center gap-2 rounded-xl border border-slate-800 p-3 text-[10px]"><input type="checkbox" checked={draft.productIds.includes(product.id)} onChange={() => setDraft(value => ({ ...value, productIds: value.productIds.includes(product.id) ? value.productIds.filter(id => id !== product.id) : [...value.productIds, product.id] }))} /><span>{product.name}</span></label>)}
            </div>
            {!storeProducts.length && <p className="mt-2 text-[10px] text-amber-300">Cadastre produtos antes de criar um cupom.</p>}
          </div>
          <label className="flex items-center gap-2 text-[10px]"><input type="checkbox" checked={draft.active} onChange={event => setDraft(value => ({ ...value, active: event.target.checked }))} />Ativar assim que salvar</label>
          <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void save()} className="min-h-10 rounded-xl bg-emerald-500 px-4 text-[9px] font-black uppercase text-slate-950">{busy ? 'Salvando…' : draft.id ? 'Salvar alterações' : 'Criar cupom'}</button><button type="button" disabled={busy} onClick={reset} className="min-h-10 rounded-xl border border-slate-700 px-4 text-[9px] font-black uppercase text-slate-300">Cancelar</button></div>
        </div>
      )}

      {loading ? <p className="rounded-2xl border border-slate-800 p-4 text-[10px] text-slate-400">Carregando cupons…</p> : promotions.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-700 p-5 text-center text-[10px] text-slate-400">Nenhum cupom criado para esta loja.</p> : (
        <div className="space-y-2">{promotions.map(promotion => <article key={promotion.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4"><div><div className="flex items-center gap-2"><strong className="text-xs">{promotion.code}</strong><span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${promotion.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{promotion.active ? 'Ativo' : 'Pausado'}</span></div><p className="mt-1 text-[10px] text-slate-400">{promotion.title} · {promotion.discountType === 'percentage' ? `${promotion.discountValue}%` : `R$ ${promotion.discountValue.toFixed(2)}`} · {promotion.redemptionCount} uso(s)</p></div><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => { setDraft(fromPromotion(promotion)); setShowForm(true); }} className="min-h-9 rounded-xl border border-slate-700 px-3 text-[8px] font-black uppercase">Editar</button><button type="button" disabled={busy} onClick={() => void toggle(promotion)} className="min-h-9 rounded-xl border border-slate-700 px-3 text-[8px] font-black uppercase">{promotion.active ? 'Pausar' : 'Ativar'}</button></div></article>)}</div>
      )}
    </section>
  );
}
