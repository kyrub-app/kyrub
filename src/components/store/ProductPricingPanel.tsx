import { useEffect, useMemo, useState } from 'react';
import { Calculator, Check, CircleDollarSign, FlaskConical, LoaderCircle } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  calculateCompositionUnitCost,
  calculateMarginGapPercentagePoints,
  calculateProductCostImpact,
  calculateSaleMarginPercent,
  calculateSuggestedPrice,
  parseProductPricingSettings,
  resolveInventoryPricingCost,
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
  onApplySuggestedPrice?: (price: number) => void;
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

const latestPurchaseCost = (item: InventoryCatalogItem | null): number | null => {
  if (!item) return null;
  if (
    typeof item.lastPurchaseUnitCostMinor === 'number'
    && Number.isFinite(item.lastPurchaseUnitCostMinor)
    && item.lastPurchaseUnitCostMinor > 0
  ) return item.lastPurchaseUnitCostMinor / 100;
  return Number.isFinite(item.purchaseCost) && item.purchaseCost > 0
    ? item.purchaseCost
    : null;
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
  const [impactItemId, setImpactItemId] = useState('');
  const [projectedCost, setProjectedCost] = useState('');
  const [projectedQuantity, setProjectedQuantity] = useState('');

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

  const compositionItems = useMemo(
    () => composition.lines.flatMap(line => {
      const item = catalog.find(candidate => candidate.id === line.inventoryItemId);
      return item ? [item] : [];
    }),
    [catalog, composition.lines]
  );

  useEffect(() => {
    const selected = compositionItems.find(item => item.id === impactItemId);
    if (selected) return;
    const first = compositionItems[0] ?? null;
    setImpactItemId(first?.id ?? '');
    const lastCost = latestPurchaseCost(first);
    setProjectedCost(lastCost === null ? '' : String(lastCost));
    setProjectedQuantity('');
  }, [compositionItems, impactItemId, productId]);

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
  const marginGap = calculateMarginGapPercentagePoints(currentMargin, validTargetMargin);
  const marginChanged = validTargetMargin !== null &&
    (savedMargin === null || Math.abs(validTargetMargin - savedMargin) > 0.000001);
  const impactItem = compositionItems.find(item => item.id === impactItemId) ?? null;
  const impactItemCost = impactItem ? resolveInventoryPricingCost(impactItem) : null;
  const impactLastPurchaseCost = latestPurchaseCost(impactItem);
  const projectedPurchaseCost = numberFromInput(projectedCost);
  const projectedPurchaseQuantity = numberFromInput(projectedQuantity);
  const costImpact = useMemo(
    () => calculateProductCostImpact(
      catalog,
      composition,
      impactItemId,
      projectedPurchaseCost,
      projectedPurchaseQuantity,
      currentSalePrice,
      validTargetMargin
    ),
    [
      catalog,
      composition,
      impactItemId,
      projectedPurchaseCost,
      projectedPurchaseQuantity,
      currentSalePrice,
      validTargetMargin,
    ]
  );

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
            Custo médio, meta de margem e preço sugerido
          </h4>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            A meta de margem é privada e será a referência para comparar a margem realizada. O Kyrub nunca altera o preço público automaticamente.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <span className="block text-[8px] font-black uppercase text-slate-500">Custo médio da ficha</span>
          <strong className={`mt-1 block text-sm ${unitCost === null ? 'text-amber-300' : 'text-white'}`}>
            {unitCost === null ? 'Custo incompleto' : currency.format(unitCost)}
          </strong>
          <span className="mt-1 block text-[8px] text-slate-600">Base econômica atual do estoque</span>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <span className="block text-[8px] font-black uppercase text-slate-500">Preço atual</span>
          <strong className="mt-1 block text-sm text-white">
            {currentSalePrice === null ? 'Não informado' : currency.format(currentSalePrice)}
          </strong>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <span className="block text-[8px] font-black uppercase text-slate-500">Margem atual estimada</span>
          <strong className="mt-1 block text-sm text-cyan-300">
            {currentMargin === null ? '—' : `${percent.format(currentMargin)}%`}
          </strong>
          {marginGap !== null && (
            <span className={`mt-1 block text-[8px] ${marginGap >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
              {marginGap >= 0 ? '+' : ''}{percent.format(marginGap)} p.p. vs meta
            </span>
          )}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
          <span className="block text-[8px] font-black uppercase text-slate-500">Preço sugerido</span>
          <strong className="mt-1 block text-sm text-emerald-300">
            {suggestedPrice === null ? '—' : currency.format(roundCurrency(suggestedPrice))}
          </strong>
          <span className="mt-1 block text-[8px] text-slate-600">Para alcançar a meta informada</span>
        </div>
      </div>

      <div className={`mt-3 grid gap-3 ${onApplySuggestedPrice ? 'sm:grid-cols-[1fr_auto_auto]' : 'sm:grid-cols-[1fr_auto]'} sm:items-end`}>
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
        {onApplySuggestedPrice && (
          <button
            type="button"
            onClick={() => suggestedPrice !== null && onApplySuggestedPrice(roundCurrency(suggestedPrice))}
            disabled={disabled || suggestedPrice === null}
            className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 text-[9px] font-black uppercase text-slate-950 disabled:opacity-35"
          >
            <CircleDollarSign className="h-3.5 w-3.5" />
            Aplicar preço sugerido
          </button>
        )}
      </div>

      {compositionItems.length > 0 && (
        <div className="mt-4 rounded-2xl border border-cyan-500/15 bg-slate-950/70 p-3">
          <div className="flex items-start gap-2">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
            <div>
              <strong className="block text-[10px] font-black uppercase text-cyan-200">
                Simular próxima reposição
              </strong>
              <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                Informe quantidade e custo hipotéticos de uma nova entrada. O Kyrub projeta a nova média móvel sem salvar compra, estoque ou preço de venda.
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="text-[8px] font-black uppercase text-slate-500">
              Insumo da ficha
              <select
                value={impactItemId}
                onChange={event => {
                  const nextId = event.target.value;
                  setImpactItemId(nextId);
                  const nextItem = compositionItems.find(item => item.id === nextId) ?? null;
                  const lastCost = latestPurchaseCost(nextItem);
                  setProjectedCost(lastCost === null ? '' : String(lastCost));
                  setProjectedQuantity('');
                }}
                disabled={disabled}
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
              >
                {compositionItems.map(item => {
                  const pricingCost = resolveInventoryPricingCost(item);
                  return (
                    <option key={item.id} value={item.id}>
                      {item.name} — {pricingCost.unitCost === null ? 'custo incompleto' : `${currency.format(pricingCost.unitCost)} / ${item.unit}`}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="text-[8px] font-black uppercase text-slate-500">
              Quantidade hipotética ({impactItem?.unit ?? 'unidade'})
              <input
                type="number"
                min="0.000001"
                step="any"
                value={projectedQuantity}
                onChange={event => setProjectedQuantity(event.target.value)}
                disabled={disabled}
                placeholder="Informe a quantidade"
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
              />
            </label>
            <label className="text-[8px] font-black uppercase text-slate-500">
              Custo da nova compra por {impactItem?.unit ?? 'unidade'}
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={projectedCost}
                onChange={event => setProjectedCost(event.target.value)}
                disabled={disabled}
                placeholder="Informe o custo"
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
              />
            </label>
          </div>

          {impactItem && (
            <p className="mt-2 text-[8px] text-slate-600">
              Custo médio atual: {impactItemCost?.unitCost === null || impactItemCost === null ? 'incompleto' : currency.format(impactItemCost.unitCost)}
              {' · '}Última compra: {impactLastPurchaseCost === null ? 'não informada' : currency.format(impactLastPurchaseCost)}
              {' · '}Saldo: {impactItem.currentQuantity} {impactItem.unit}
            </p>
          )}

          {costImpact ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
                <span className="block text-[8px] uppercase text-slate-500">Média do insumo</span>
                <strong className="mt-1 block text-xs text-white">
                  {currency.format(roundCurrency(costImpact.currentInventoryUnitCost))}
                  {' → '}{currency.format(roundCurrency(costImpact.projectedInventoryUnitCost))}
                </strong>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
                <span className="block text-[8px] uppercase text-slate-500">Novo custo da ficha</span>
                <strong className="mt-1 block text-xs text-white">
                  {currency.format(roundCurrency(costImpact.projectedUnitCost))}
                </strong>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
                <span className="block text-[8px] uppercase text-slate-500">Variação do custo</span>
                <strong className="mt-1 block text-xs text-cyan-200">
                  {costImpact.unitCostDelta >= 0 ? '+' : ''}{currency.format(roundCurrency(costImpact.unitCostDelta))}
                  {costImpact.unitCostDeltaPercent === null
                    ? ''
                    : ` (${costImpact.unitCostDeltaPercent >= 0 ? '+' : ''}${percent.format(costImpact.unitCostDeltaPercent)}%)`}
                </strong>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
                <span className="block text-[8px] uppercase text-slate-500">Margem projetada</span>
                <strong className="mt-1 block text-xs text-white">
                  {costImpact.projectedMarginPercent === null
                    ? '—'
                    : `${percent.format(costImpact.projectedMarginPercent)}%`}
                </strong>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
                <span className="block text-[8px] uppercase text-slate-500">Preço sugerido projetado</span>
                <strong className="mt-1 block text-xs text-emerald-300">
                  {costImpact.projectedSuggestedPrice === null
                    ? 'Defina a margem desejada'
                    : currency.format(roundCurrency(costImpact.projectedSuggestedPrice))}
                </strong>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[9px] text-slate-500">
              Informe quantidade e custo positivos. Se o estoque atual tiver base econômica incompleta, o Kyrub não inventará uma média projetada.
            </p>
          )}
        </div>
      )}

      {suggestedPrice !== null && !onApplySuggestedPrice && (
        <p className="mt-3 rounded-xl border border-emerald-500/15 bg-slate-950 px-3 py-2 text-[9px] leading-relaxed text-slate-400">
          Use o preço sugerido como referência no campo “Preço de venda”. A alteração pública continua sendo feita pelo salvamento normal do item.
        </p>
      )}
      {unitCost === null && composition.lines.length > 0 && (
        <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[9px] leading-relaxed text-amber-200">
          Um ou mais componentes da ficha estão sem base econômica confiável. O Kyrub não usa custo zero nem último preço antigo para fabricar uma margem atual.
        </p>
      )}
      {status && (
        <p className="mt-3 text-[9px] text-slate-400">{status}</p>
      )}
    </section>
  );
}
