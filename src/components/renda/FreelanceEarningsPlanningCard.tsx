import { useState } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { calculateFreelanceEarningsPlan, parseFreelancePlanningMoney } from '../../../shared/freelanceEarningsPlanning';

const money = (minor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);
const fieldClass = 'mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white';
export function FreelanceEarningsPlanningCard() {
  const [jobs, setJobs] = useState('');
  const [fee, setFee] = useState('');
  const [cost, setCost] = useState('0');
  const feeMinor = parseFreelancePlanningMoney(fee);
  const costMinor = parseFreelancePlanningMoney(cost);
  const plan = /^\d{1,5}$/.test(jobs) && feeMinor !== null && costMinor !== null
    ? calculateFreelanceEarningsPlan({ jobs: Number(jobs), feeMinor, costMinor })
    : null;
  return (
    <section id="freelance-earnings-planning" className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-center gap-2">
        <CircleDollarSign className="h-4 w-4 text-orange-300"/>
        <h3 className="text-xs font-black uppercase tracking-wider text-white">Planejamento de ganhos</h3>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        Simule sua renda para o período que escolher, considerando seus serviços e custos por trabalho.
        Os valores são estimativas informadas por você, não recebimentos confirmados.
      </p>
      <div className="mt-4 space-y-3">
        <label className="block text-[10px] font-bold text-slate-300">Quantidade de freelas previstos
          <input className={fieldClass} inputMode="numeric" value={jobs} maxLength={5} placeholder="Ex.: 8" onChange={event => setJobs(event.target.value)}/>
        </label>
        <label className="block text-[10px] font-bold text-slate-300">Valor médio por freela (R$)
          <input className={fieldClass} inputMode="decimal" value={fee} maxLength={10} placeholder="Ex.: 120,00" onChange={event => setFee(event.target.value)}/>
        </label>
        <label className="block text-[10px] font-bold text-slate-300">Custo médio por freela (R$)
          <input className={fieldClass} inputMode="decimal" value={cost} maxLength={10} onChange={event => setCost(event.target.value)}/>
        </label>
      </div>
      {plan ? <div className="mt-4 grid gap-2" aria-live="polite">
        {([['Receita bruta prevista', plan.grossMinor], ['Custos estimados', plan.totalCostMinor], ['Ganho líquido estimado', plan.netMinor]] as const).map(([label, value]) =>
          <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
            <span className="text-[10px] text-slate-400">{label}</span>
            <strong className="text-xs text-white">{money(value)}</strong>
          </div>)}
      </div> : <p className="mt-3 text-[10px] text-slate-400">Informe quantidade e valores válidos para calcular a projeção.</p>}
      <p className="mt-4 text-[10px] leading-relaxed text-slate-400">
        Histórico financeiro confirmado ainda indisponível para Freelas. Esta simulação não registra serviços, pagamentos ou saldo e não é salva ao fechar.
      </p>
    </section>
  );
}
