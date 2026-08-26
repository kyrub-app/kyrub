import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { BadgePercent, CheckCircle2, LoaderCircle, PackageSearch } from 'lucide-react';
import type { KyrubActionProposal } from '../../../shared/kyrubActions';
import {
  normalizeCreateStorePromotionProposal,
  type CreateStorePromotionProposal,
} from '../../../shared/storePromotionAction';
import { executeKyrubAction } from '../../actions/kyrubActionService';
import { auth } from '../../utils/firebase';
import {
  subscribeToPreferredPublicProducts,
  type PublicProduct,
} from '../../utils/publicProducts';
import {
  listMarketplacePromotions,
  type PublicMarketplacePromotion,
} from '../../utils/marketplaceCheckout';

type ScopeMode = 'store' | 'products' | 'category';
type DiscountType = 'percentage' | 'fixed';

const codeValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const createActionId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `manual-promotion-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const findVoucherCards = (): HTMLElement[] => {
  const headings = Array.from(document.querySelectorAll('h2,h3,h4,strong'));
  const targets = headings.filter(element => {
    const text = element.textContent?.trim().toLocaleUpperCase('pt-BR') ?? '';
    return text === 'CRIAR NOVO CUPOM' || text === 'CUPONS PROMOCIONAIS ATIVOS';
  });

  return targets.flatMap(target => {
    const card = target.closest('section,article,.rounded-3xl,.rounded-2xl');
    return card instanceof HTMLElement ? [card] : [];
  });
};

export function ManualStorePromotionBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [promotions, setPromotions] = useState<PublicMarketplacePromotion[]>([]);
  const [scope, setScope] = useState<ScopeMode>('products');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [hours, setHours] = useState('24');
  const [maxRedemptions, setMaxRedemptions] = useState('0');
  const [perBuyer, setPerBuyer] = useState('1');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setProducts([]);
      return;
    }
    return subscribeToPreferredPublicProducts(
      user.uid,
      result => setProducts(result.products),
      () => setProducts([])
    );
  }, [user?.uid]);

  const refreshPromotions = async (storeId: string): Promise<void> => {
    const next = await listMarketplacePromotions(storeId);
    setPromotions(next);
  };

  useEffect(() => {
    if (!user) {
      setPromotions([]);
      return;
    }
    void refreshPromotions(user.uid);
  }, [user?.uid]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let currentHost: HTMLDivElement | null = null;
    let hiddenCards: Array<{ element: HTMLElement; display: string }> = [];

    const restore = () => {
      hiddenCards.forEach(({ element, display }) => {
        if (element.isConnected) element.style.display = display;
      });
      hiddenCards = [];
      currentHost?.remove();
      currentHost = null;
      setHost(null);
    };

    const sync = () => {
      if (cancelled) return;
      const cards = findVoucherCards();
      if (cards.length === 0) {
        if (currentHost) restore();
        timer = window.setTimeout(sync, 120);
        return;
      }

      const first = cards[0];
      if (!currentHost || !currentHost.isConnected) {
        restore();
        const parent = first.parentElement;
        if (parent) {
          currentHost = document.createElement('div');
          currentHost.id = 'kyrub-manual-store-promotion-host';
          parent.insertBefore(currentHost, first);
          hiddenCards = cards.map(element => ({
            element,
            display: element.style.display,
          }));
          cards.forEach(element => {
            element.style.display = 'none';
          });
          setHost(currentHost);
        }
      }

      timer = window.setTimeout(sync, 120);
    };

    sync();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      restore();
    };
  }, []);

  const categories = useMemo(
    () => [...new Set(products.map(product => product.category.trim()).filter(Boolean))].sort(),
    [products]
  );

  const effectiveProductIds = useMemo(() => {
    if (scope === 'store') return products.map(product => product.id);
    if (scope === 'category') {
      return products.filter(product => product.category === category).map(product => product.id);
    }
    return selectedProductIds;
  }, [category, products, scope, selectedProductIds]);

  const reset = () => {
    setCode('');
    setDiscountValue('');
    setMaxRedemptions('0');
    setPerBuyer('1');
    setHours('24');
    setSelectedProductIds([]);
    setCategory('');
    setScope('products');
  };

  const publish = async () => {
    if (!user || busy) return;
    setMessage('');
    setSuccess(false);

    const normalizedCode = codeValue(code);
    const parsedDiscount = Number(discountValue.replace(',', '.'));
    const parsedHours = Number.parseInt(hours, 10);
    const parsedMax = Number.parseInt(maxRedemptions || '0', 10);
    const parsedPerBuyer = Number.parseInt(perBuyer || '1', 10);

    if (normalizedCode.length < 3) {
      setMessage('Informe um código de cupom com pelo menos 3 caracteres.');
      return;
    }
    if (!Number.isFinite(parsedDiscount) || parsedDiscount <= 0) {
      setMessage('Informe um valor de desconto válido.');
      return;
    }
    if (discountType === 'percentage' && parsedDiscount >= 100) {
      setMessage('Neste fluxo Pix, o desconto percentual precisa ser menor que 100%.');
      return;
    }
    if (!Number.isInteger(parsedHours) || parsedHours <= 0) {
      setMessage('Informe uma validade em horas maior que zero.');
      return;
    }
    if (effectiveProductIds.length === 0) {
      setMessage('Escolha pelo menos um produto, uma categoria com itens ou toda a loja.');
      return;
    }

    const now = new Date();
    const end = new Date(now.getTime() + parsedHours * 60 * 60 * 1000);
    const productLabel = scope === 'store'
      ? 'Toda a loja'
      : scope === 'category'
        ? `Categoria: ${category}`
        : effectiveProductIds.length === 1
          ? products.find(product => product.id === effectiveProductIds[0])?.name ?? '1 produto'
          : `${effectiveProductIds.length} produtos`;

    let proposal: CreateStorePromotionProposal;
    try {
      proposal = normalizeCreateStorePromotionProposal({
        id: createActionId(),
        type: 'create_store_promotion',
        storeId: user.uid,
        productIds: effectiveProductIds,
        productLabel,
        code: normalizedCode,
        title: discountType === 'percentage'
          ? `${parsedDiscount}% OFF · ${productLabel}`
          : `${money.format(parsedDiscount)} OFF · ${productLabel}`,
        badge: discountType === 'percentage'
          ? `${parsedDiscount}% OFF`
          : `${money.format(parsedDiscount)} OFF`,
        discountType,
        discountValue: parsedDiscount,
        eligibilityMode: 'public',
        startsAt: now.toISOString(),
        endsAt: end.toISOString(),
        maxRedemptions: Number.isInteger(parsedMax) && parsedMax >= 0 ? parsedMax : 0,
        maxRedemptionsPerBuyer:
          Number.isInteger(parsedPerBuyer) && parsedPerBuyer >= 0 ? parsedPerBuyer : 1,
        requiresConfirmation: true,
        origin: 'manual',
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Revise os dados do cupom.');
      return;
    }

    setBusy(true);
    try {
      await executeKyrubAction(
        user,
        proposal as unknown as KyrubActionProposal,
        true
      );
      await refreshPromotions(user.uid);
      setSuccess(true);
      setMessage(`Cupom ${proposal.code} publicado com sucesso.`);
      reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível publicar o cupom.');
    } finally {
      setBusy(false);
    }
  };

  if (!host) return null;

  return createPortal(
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="flex items-center gap-2 text-orange-400">
          <BadgePercent className="h-5 w-5" />
          <h3 className="text-sm font-black uppercase">Criar novo cupom</h3>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-mono font-bold uppercase text-slate-400">Código do cupom</span>
            <input
              value={code}
              onChange={event => setCode(codeValue(event.target.value))}
              placeholder="Ex: XBURGER95"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm font-bold uppercase text-white"
            />
          </label>

          <div>
            <span className="mb-2 block text-[10px] font-mono font-bold uppercase text-slate-400">Aplicar em</span>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['store', 'Toda a loja'],
                ['products', 'Produtos'],
                ['category', 'Categoria'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScope(value)}
                  className={`rounded-xl border px-2 py-2 text-[10px] font-black uppercase ${scope === value
                    ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                    : 'border-slate-700 bg-slate-950 text-slate-400'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {scope === 'products' && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <div className="mb-3 flex items-center gap-2 text-slate-300">
                <PackageSearch className="h-4 w-4" />
                <strong className="text-xs">Selecione um ou mais produtos</strong>
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {products.map(product => {
                  const checked = selectedProductIds.includes(product.id);
                  return (
                    <label key={product.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-800 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedProductIds(current =>
                          checked
                            ? current.filter(id => id !== product.id)
                            : [...current, product.id]
                        )}
                        className="h-4 w-4 accent-orange-500"
                      />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-xs text-white">{product.name}</strong>
                        <span className="text-[10px] text-slate-500">{product.category} · {money.format(product.price)}</span>
                      </span>
                    </label>
                  );
                })}
                {products.length === 0 && (
                  <p className="py-3 text-center text-xs text-slate-500">Nenhum produto publicado encontrado.</p>
                )}
              </div>
            </div>
          )}

          {scope === 'category' && (
            <label className="block">
              <span className="mb-1 block text-[10px] font-mono font-bold uppercase text-slate-400">Categoria</span>
              <select
                value={category}
                onChange={event => setCategory(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
              >
                <option value="">Selecione uma categoria</option>
                {categories.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-mono font-bold uppercase text-slate-400">Tipo de desconto</span>
              <select
                value={discountType}
                onChange={event => setDiscountType(event.target.value as DiscountType)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
              >
                <option value="percentage">Porcentagem (%)</option>
                <option value="fixed">Valor fixo (R$)</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-mono font-bold uppercase text-slate-400">Valor</span>
              <input
                inputMode="decimal"
                value={discountValue}
                onChange={event => setDiscountValue(event.target.value)}
                placeholder={discountType === 'percentage' ? 'Ex: 20' : 'Ex: 10,00'}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
              />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-[9px] font-mono font-bold uppercase text-slate-400">Validade (h)</span>
              <input inputMode="numeric" value={hours} onChange={event => setHours(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] font-mono font-bold uppercase text-slate-400">Limite total</span>
              <input inputMode="numeric" value={maxRedemptions} onChange={event => setMaxRedemptions(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] font-mono font-bold uppercase text-slate-400">Por cliente</span>
              <input inputMode="numeric" value={perBuyer} onChange={event => setPerBuyer(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white" />
            </label>
          </div>

          {message && (
            <p className={`rounded-xl border px-3 py-2.5 text-xs font-bold ${success
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/25 bg-red-500/10 text-red-200'}`}
            >
              {success && <CheckCircle2 className="mr-1 inline h-4 w-4" />}
              {message}
            </p>
          )}

          <button
            type="button"
            onClick={() => void publish()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-black uppercase text-slate-950 disabled:opacity-60"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {busy ? 'Publicando...' : 'Ativar cupom promocional'}
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <h3 className="text-sm font-black uppercase text-white">Cupons promocionais ativos</h3>
        <div className="mt-4 space-y-2">
          {promotions.map(promotion => (
            <div key={promotion.id} className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block truncate text-sm text-white">{promotion.code}</strong>
                  <span className="text-xs text-slate-500">{promotion.badge}</span>
                </div>
                <span className="rounded-full border border-orange-500/25 bg-orange-500/10 px-2 py-1 text-[10px] font-black text-orange-300">ATIVO</span>
              </div>
            </div>
          ))}
          {promotions.length === 0 && (
            <p className="py-3 text-center text-xs text-slate-500">Nenhum cupom público ativo no momento.</p>
          )}
        </div>
      </section>
    </div>,
    host
  );
}
