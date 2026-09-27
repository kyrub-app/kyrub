import type React from 'react';
import { CalendarClock, Repeat2, ShoppingBag } from 'lucide-react';
import {
  ONE_TIME_PRODUCT_SALE_MODALITY,
  buildSubscriptionSaleModality,
  isSubscriptionSaleModality,
  type ProductSaleModality,
  type SubscriptionBenefitKind,
  type SubscriptionBillingUnit,
} from '../../../shared/productSaleModality';

export interface ProductSaleModalityEditorProps {
  value: ProductSaleModality;
  onChange: (value: ProductSaleModality) => void;
  disabled?: boolean;
}

const BILLING_OPTIONS: Array<{
  value: SubscriptionBillingUnit;
  label: string;
}> = [
  { value: 'day', label: 'Dia(s)' },
  { value: 'week', label: 'Semana(s)' },
  { value: 'month', label: 'Mês(es)' },
  { value: 'year', label: 'Ano(s)' },
];

const BENEFIT_OPTIONS: Array<{
  value: SubscriptionBenefitKind;
  label: string;
  description: string;
}> = [
  {
    value: 'access',
    label: 'Acesso contínuo',
    description: 'Mensalidade, clube ou serviço sem limite de usos por ciclo.',
  },
  {
    value: 'usage_credits',
    label: 'Quantidade de usos',
    description: 'Ex.: 2 cortes, 4 unhas ou 20 refeições por ciclo.',
  },
  {
    value: 'recurring_delivery',
    label: 'Entregas recorrentes',
    description: 'Ex.: cesta, kit ou produto entregue uma ou mais vezes por ciclo.',
  },
];

const positiveInteger = (value: string, fallback = 1): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const ProductSaleModalityEditor: React.FC<ProductSaleModalityEditorProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const subscription = isSubscriptionSaleModality(value)
    ? value.subscription
    : null;

  const setSubscription = (input?: {
    billingUnit?: SubscriptionBillingUnit;
    billingIntervalCount?: number;
    benefitKind?: SubscriptionBenefitKind;
    unitsPerCycle?: number | null;
  }): void => {
    const currentBenefitKind =
      input?.benefitKind ?? subscription?.benefit.kind ?? 'access';
    const currentUnits =
      currentBenefitKind === 'access'
        ? null
        : input?.unitsPerCycle
          ?? subscription?.benefit.unitsPerCycle
          ?? 1;

    onChange(
      buildSubscriptionSaleModality({
        billingUnit:
          input?.billingUnit ?? subscription?.billingInterval.unit ?? 'month',
        billingIntervalCount:
          input?.billingIntervalCount ?? subscription?.billingInterval.count ?? 1,
        benefitKind: currentBenefitKind,
        unitsPerCycle: currentUnits,
      })
    );
  };

  return (
    <section
      id="product-sale-modality-control"
      className="space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4"
    >
      <div className="flex items-start gap-3">
        <Repeat2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <div>
          <h4 className="text-[10px] font-black uppercase tracking-wide text-cyan-200">
            Forma de venda
          </h4>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
            Escolha se este item é comprado uma vez ou renovado como assinatura.
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          id="product-sale-mode-one-time"
          onClick={() => onChange(ONE_TIME_PRODUCT_SALE_MODALITY)}
          disabled={disabled}
          className={`rounded-xl border px-3 py-3 text-left transition disabled:opacity-45 ${
            value.mode === 'one_time'
              ? 'border-cyan-400/50 bg-cyan-500/10'
              : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
          }`}
        >
          <span className="flex items-center gap-2 text-[10px] font-black uppercase text-white">
            <ShoppingBag className="h-3.5 w-3.5 text-cyan-300" />
            Compra única
          </span>
          <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">
            O cliente compra este produto ou serviço uma vez.
          </span>
        </button>

        <button
          type="button"
          id="product-sale-mode-subscription"
          onClick={() => setSubscription()}
          disabled={disabled}
          className={`rounded-xl border px-3 py-3 text-left transition disabled:opacity-45 ${
            value.mode === 'subscription'
              ? 'border-cyan-400/50 bg-cyan-500/10'
              : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
          }`}
        >
          <span className="flex items-center gap-2 text-[10px] font-black uppercase text-white">
            <CalendarClock className="h-3.5 w-3.5 text-cyan-300" />
            Assinatura
          </span>
          <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">
            O cliente renova este item em ciclos recorrentes.
          </span>
        </button>
      </div>

      {subscription && (
        <div
          id="product-subscription-terms"
          className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3"
        >
          <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
            <label className="block">
              <span className="mb-1 block text-[9px] font-black uppercase text-slate-400">
                A cada
              </span>
              <input
                id="product-subscription-interval-count"
                type="number"
                min="1"
                step="1"
                value={subscription.billingInterval.count}
                onChange={event =>
                  setSubscription({
                    billingIntervalCount: positiveInteger(event.target.value),
                  })
                }
                disabled={disabled}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500 disabled:opacity-45"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[9px] font-black uppercase text-slate-400">
                Período
              </span>
              <select
                id="product-subscription-billing-unit"
                value={subscription.billingInterval.unit}
                onChange={event =>
                  setSubscription({
                    billingUnit: event.target.value as SubscriptionBillingUnit,
                  })
                }
                disabled={disabled}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500 disabled:opacity-45"
              >
                {BILLING_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[9px] font-black uppercase text-slate-400">
              O que a assinatura entrega por ciclo
            </span>
            <select
              id="product-subscription-benefit-kind"
              value={subscription.benefit.kind}
              onChange={event =>
                setSubscription({
                  benefitKind: event.target.value as SubscriptionBenefitKind,
                })
              }
              disabled={disabled}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500 disabled:opacity-45"
            >
              {BENEFIT_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">
              {BENEFIT_OPTIONS.find(
                option => option.value === subscription.benefit.kind
              )?.description}
            </span>
          </label>

          {subscription.benefit.kind !== 'access' && (
            <label className="block">
              <span className="mb-1 block text-[9px] font-black uppercase text-slate-400">
                Quantidade por ciclo
              </span>
              <input
                id="product-subscription-units-per-cycle"
                type="number"
                min="1"
                step="1"
                value={subscription.benefit.unitsPerCycle ?? 1}
                onChange={event =>
                  setSubscription({
                    unitsPerCycle: positiveInteger(event.target.value),
                  })
                }
                disabled={disabled}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500 disabled:opacity-45"
              />
            </label>
          )}

          <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[9px] leading-relaxed text-amber-200/80">
            O cadastro da assinatura já pode ser salvo. A contratação recorrente do cliente será liberada somente pelo fluxo próprio de assinatura, nunca pelo checkout comum.
          </p>
        </div>
      )}
    </section>
  );
};
