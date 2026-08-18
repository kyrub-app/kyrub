import { useEffect, useMemo, useState } from 'react';
import { Calculator, Check, CircleDollarSign, LoaderCircle } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  calculateCompositionUnitCost,
  calculateSaleMarginPercent,
  calculateSuggestedPrice,
  parseProductPricingSettings,
  roundCurrency,
  saveProductTargetMargin,
} from '../../utils/productPricing';
import {
  getProductInventoryDocumentPath,
  type InventoryCatalogItem,
  type ProductComposition,
} from '../../utils/productInventory';
import { auth, db } from '../../utils/firebase';

interface ProductPricingPanelProps {
  userId: string;
  productId: string;
  catalog: InventoryCatalogItem[];
  composition: ProductComposition;
  currentSalePrice: number | null;
  disabled?: boolean;
  onApplySuggestedPrice: (price: number) => void;
}

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const percent = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const numberFromInput = (value: string): number | null => {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

export function ProductPricingPanel({
  userId,
  productId,
  catalog,
  composition,
  currentSalePrice,
  disabled = false,
  onApplySuggestedPrice,
}: ProductPricingPanelProps) {
  const [targetMargin, setTargetMargin] = useState('');
  const [savedMargin, setSavedMargin] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!userId || !productId) return;
    return onSnapshot(
      doc(db, getProductInventoryDocumentPath(userId)),
      snapshot => {
        const setting = parseProductPricingSettings(
          snapshot.data()?.productPricingSettings
        )[productId];
        if (setting) {
          setSavedMargin(setting.targetMarginPercent);
          setTargetMargin(String(setting.targetMarginPercent));
        } else {
          setSavedMargin(null);
          setTargetMargin('');
        }
      },
      error => {
        console.warn('Não foi possível carregar a meta de margem do produto.', error);
      }
    );
  }, [productId, userId]);

  const unitCost = useMemo(
    () => calculateCompositionUnitCost(catalog, composition),
    [catalog, composition]
  );
  const parsedTargetMargin = numberFromInput(targetMargin);
  const validTargetMargin = parsedTargetMargin !== null &&
    parsedTargetMargin >= 0 && parsedTargetMargin < 100
    ? parsedTargetMargin
    : null;
  const suggestedPrice = calculateSuggestedPrice(unitCost, validTargetMargin);
  const currentMargin = calculateSaleMarginPercent(unitCost, currentSalePrice);
  const marginChanged = validTargetMargin !== null &&
    (savedMargin === null || Math.abs(validTargetMargin - savedMargin) > 0.000001);

  const saveMargin = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user || user.uid !== userId) {
      setStatus('Faça login novamente para salvar a margem.');
      return;
    }
    if (validTargetMargin === null) {
      setStatus('Informe uma margem entre 0% e 99,99%.');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      await saveProductTargetMargin(user, productId, validTargetMargin);
      setSavedMargin(validTargetMargin);
      setStatus('Meta de margem salva.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Não foi possível salvar a margem.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      id="product-pricing-panel"
      className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
          <Calculator className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-emerald-300">
            Precificação da ficha técnica
          </span>
          <h4 className="mt-1 text-sm font-black text-white">
            Custo, margem e preço sugerido
          </h4>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            A meta de margem é privada. O Kyrub nunca altera o preço público automaticamente.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <span className="block text-[8px] font-black uppercase text-slate-500">Custo calculado</span>
          <strong className={`mt-1 block text-sm ${unitCost === null ? 'text-amber-300' : 'text-white'}`}>
            {unitCost === null ? 'Custo incompleto' : currency.format(unitCost)}
          </strong>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <span className="block text-[8px] font-black uppercase text-slate-500">Preço atual</span>
          <strong className="mt-1 block text-sm text-white">
            {currentSalePrice === null ? 'Não informado' : currency.format(currentSalePrice)}
          </strong>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <span className="block text-[8px] font-black uppercase text-slate-500">Margem atual</span>
          <strong className="mt-1 block text-sm text-cyan-300">
            {currentMargin === null ? '—' : `${percent.format(currentMargin)}%`}
          </strong>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <span className="block text-[8px] font-black uppercase text-slate-500">Preço sugerido</span>
          <strong className="mt-1 block text-sm text-emerald-300">
            {suggestedPrice === null ? '—' : currency.format(roundCurrency(suggestedPrice))}
          </strong>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="text-[9px] font-black uppercase text-slate-500">
          Margem desejada (%)
          <input
            type="number"
            min="0"
            max="99.99"
            step="0.1"
            value={targetMargin}
            onChange={event => {
              setTargetMargin(event.target.value);
              setStatus('');
            }}
            disabled={disabled || saving}
            placeholder="Ex.: 40"
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
          />
        </label>
        <button
          type="button"
          onClick={() => void saveMargin()}
          disabled={disabled || saving || validTargetMargin === null || !marginChanged}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 text-[9px] font-black uppercase text-emerald-200 disabled:opacity-35"
        >
          {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Salvar margem
        </button>
        <button
          type="button"
          onClick={() => suggestedPrice !== null && onApplySuggestedPrice(roundCurrency(suggestedPrice))}
          disabled={disabled || suggestedPrice === null}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 text-[9px] font-black uppercase text-slate-950 disabled:opacity-35"
        >
          <CircleDollarSign className="h-3.5 w-3.5" />
          Aplicar preço sugerido
        </button>
      </div>

      {unitCost === null && composition.lines.length > 0 && (
        <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[9px] leading-relaxed text-amber-200">
          Informe um custo de compra maior que zero para todos os componentes da ficha técnica. A entrada de estoque sem valor fiscal não será tratada como custo zero.
        </p>
      )}
      {status && (
        <p className="mt-3 text-[9px] text-slate-400">{status}</p>
      )}
    </section>
  );
}
