import { useState, type KeyboardEvent } from 'react';
import { StoreFinanceRuntime } from './StoreFinanceRuntime';
import StoreCashDeviceInventory from './store/StoreCashDeviceInventory';
import StoreFinanceHistoryWorkspace from './store/StoreFinanceHistoryWorkspace';
import StoreFinancePeriodRuntime from './store/StoreFinancePeriodRuntime';
import StoreMercadoPagoPeriodSummaryWorkspace from './store/StoreMercadoPagoPeriodSummaryWorkspace';
import StoreResultsMarginsWorkspace from './store/StoreResultsMarginsWorkspace';
import { financeMonthFromDate, financeMonthLabel, previousFinanceMonth, validFinanceMonth } from '../utils/storeFinanceCompetence';

// One route, four views: do not mount independent financial ledgers at once.
// Switching tabs only changes presentation; source collections and APIs remain unchanged.
export const STORE_FINANCE_TABS = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'payments', label: 'Pagamentos e Contas' },
  { id: 'margins', label: 'Resultados & Margens' },
  { id: 'cash', label: 'Caixa operacional' },
] as const;

export type StoreFinanceTab = (typeof STORE_FINANCE_TABS)[number]['id'];

function FinanceTabsForStore({ storeId }: { storeId: string }) {
  const [activeTab, setActiveTab] = useState<StoreFinanceTab>('overview');
  const [period, setPeriod] = useState(() => financeMonthFromDate(new Date()));
  const currentMonth = financeMonthFromDate(new Date());
  const monthlyScope = activeTab === 'overview' || activeTab === 'payments';

  const handleTabKeys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = STORE_FINANCE_TABS.length - 1;
    const target = event.key === 'ArrowRight' ? (index + 1) % STORE_FINANCE_TABS.length
      : event.key === 'ArrowLeft' ? (index + last) % STORE_FINANCE_TABS.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : -1;
    if (target === -1) return;
    event.preventDefault();
    setActiveTab(STORE_FINANCE_TABS[target].id);
    const destinationId = `kyrub-finance-tab-${STORE_FINANCE_TABS[target].id}`;
    // Focus stays within the existing tab controls; no synthetic navigation
    // or second ERP routing surface is created.
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
      `#${destinationId}`
    )?.focus();
  };

  return (
    <section className="min-w-0 max-w-full space-y-4 overflow-x-hidden text-white" data-kyrub-finance-four-areas="canonical">
      <header className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <h2 className="text-sm font-black text-white">Financeiro Interno</h2>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
          Informações financeiras da loja organizadas por assunto, sem repetir lançamentos em diversos painéis.
        </p>
        <div className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Áreas do Financeiro Interno">
          {STORE_FINANCE_TABS.map((tab, index) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`kyrub-finance-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="kyrub-finance-active-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={event => handleTabKeys(event, index)}
                className={`min-h-11 shrink-0 rounded-xl border px-3 py-2 text-[10px] font-bold transition-colors ${active
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                  : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-white'}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {monthlyScope ? (
          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-3"
            data-kyrub-finance-shared-competence={period}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="kyrub-finance-competence" className="text-[10px] font-bold text-slate-300">
                Competência mensal compartilhada
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setPeriod(previousFinanceMonth(currentMonth))}
                  className="min-h-9 rounded-lg border border-slate-700 px-2 text-[9px] text-slate-300">
                  Mês anterior
                </button>
                <button type="button" onClick={() => setPeriod(currentMonth)}
                  className="min-h-9 rounded-lg border border-slate-700 px-2 text-[9px] text-slate-300">
                  Mês atual
                </button>
                <input id="kyrub-finance-competence" type="month" value={period}
                  onChange={event => { if (validFinanceMonth(event.target.value)) setPeriod(event.target.value); }}
                  className="min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-2 text-[10px] text-white" />
              </div>
            </div>
            <p className="mt-2 text-[9px] text-slate-400">
              Mês selecionado: <strong className="capitalize text-white">{financeMonthLabel(period)}</strong>.
              A Visão geral e a conciliação Mercado Pago usam esta competência.
              O Histórico pode alternar explicitamente para todos os períodos.
              Os totais acumulados do livro econômico continuam históricos, não mensais.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[9px] text-slate-400" data-kyrub-finance-independent-scope="true">
            {activeTab === 'margins'
              ? 'Resultados & Margens: panorama próprio, sem filtro mensal compartilhado. Consulte a data de cada pedido.'
              : 'Caixa operacional: sessões e declarações de dispositivos, sem integração aos totais mensais.'}
          </p>
        )}
      </header>

      <div
        id="kyrub-finance-active-panel"
        role="tabpanel"
        aria-labelledby={`kyrub-finance-tab-${activeTab}`}
        tabIndex={0}
        className="min-w-0 max-w-full space-y-4"
      >
        {activeTab === 'overview' && (
          <StoreFinancePeriodRuntime storeId={storeId} period={period} />
        )}
        {activeTab === 'payments' && (
          <>
            <StoreMercadoPagoPeriodSummaryWorkspace storeId={storeId} period={period} />
            <StoreFinanceHistoryWorkspace storeId={storeId} period={period} />
            <StoreFinanceRuntime storeId={storeId} surface="payments" />
          </>
        )}
        {activeTab === 'margins' && (
          <StoreResultsMarginsWorkspace storeId={storeId} />
        )}
        {activeTab === 'cash' && (
          <>
            <StoreFinanceRuntime storeId={storeId} surface="cash" />
            <section className="rounded-3xl border border-cyan-500/20 bg-slate-900 p-5"
              data-kyrub-cash-management-section="device-inventory">
              <h3 className="text-xs font-black uppercase text-white">Conferência de dispositivos</h3>
              <StoreCashDeviceInventory storeId={storeId} />
            </section>
          </>
        )}
      </div>
    </section>
  );
}

export function StoreFinanceCompositeRuntime({ storeId }: { storeId: string }) {
  // Reset tab state on tenant changes, preventing cross-store presentation.
  return <FinanceTabsForStore key={storeId} storeId={storeId} />;
}
