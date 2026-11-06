import type { ContractTermMonths } from '../../../shared/subscriptionContractOffers';
import { calculateSubscriptionContractOffer } from '../../../shared/subscriptionContractOffers';

type Offer = { months: ContractTermMonths; discountPercent: number };
type Props = { value: Offer[] | undefined; onChange: (next: Offer[] | undefined) => void; monthlyPrice: number; disabled?: boolean };
const TERMS = [3, 6, 12] as const;
const format = (minor: number) => (minor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function SubscriptionContractTermsEditor({ value, onChange, monthlyPrice, disabled }: Props) {
  const enabled = value !== undefined;
  const update = (months: 3 | 6 | 12, discountPercent: number | null) => {
    const current = (value ?? [{ months: 1 as const, discountPercent: 0 }]).filter(item => item.months !== months);
    if (discountPercent !== null) current.push({ months, discountPercent });
    onChange(current.sort((a, b) => a.months - b.months));
  };
  return <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3" aria-label="Opções de contratação">
    <div>
      <h4 className="text-xs font-bold text-cyan-200">Opções de contratação</h4>
      <p className="mt-1 text-xs text-slate-400">O preço acima é mensal. Configure quais contratos pré-pagos de 3, 6 ou 12 meses estarão disponíveis e seus descontos próprios. O pagamento do contrato é único, não parcelado.</p>
    </div>
    <label className="flex items-center gap-2 text-xs text-slate-200">
      <input type="checkbox" checked={enabled} disabled={disabled} onChange={event => onChange(event.target.checked ? [{ months: 1, discountPercent: 0 }] : undefined)} />
      Oferecer contratos pré-pagos por prazo
    </label>
    {enabled && <>
      <p className="text-xs text-slate-400">Referência mensal sem desconto: {format(Math.round(monthlyPrice * 100))}. Selecione os prazos que deseja oferecer.</p>
      {TERMS.map(months => {
        const offer = value?.find(item => item.months === months);
        const validPrice = Number.isFinite(monthlyPrice) && monthlyPrice >= 0;
        const total = offer && validPrice ? calculateSubscriptionContractOffer(Math.round(monthlyPrice * 100), months, offer.discountPercent) : null;
        return <div key={months} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:grid-cols-[1fr_7rem_1fr] sm:items-center">
          <label className="flex items-center gap-2 text-xs text-white"><input type="checkbox" checked={!!offer} disabled={disabled} onChange={event => update(months, event.target.checked ? 0 : null)} />{months} meses</label>
          <label className="text-xs text-slate-400">Desconto (%)
            <input aria-label={`Desconto para ${months} meses`} type="number" min="0" max="100" step="0.01" disabled={disabled || !offer} value={offer?.discountPercent ?? 0} onChange={event => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 0 && next <= 100) update(months, Math.round(next * 100) / 100);
            }} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-white disabled:opacity-50" />
          </label>
          <p className="text-xs text-slate-300">{total ? <>Total: <strong className="text-white">{format(total.totalMinor)}</strong><span className="block text-slate-500">Equivale a {format(total.monthlyEquivalentMinor)}/mês</span></> : 'Prazo não habilitado'}</p>
        </div>;
      })}
      <p className="text-xs text-amber-200">A oferta de 1 mês permanece como referência do catálogo. A contratação e a cobrança só serão liberadas quando o servidor validar o prazo, o preço e o fluxo de pagamento.</p>
    </>}
  </section>;
}
