import { StoreFinanceRuntime } from './StoreFinanceRuntime';
import StoreCashDeviceInventory from './store/StoreCashDeviceInventory';
import StoreFinanceHistoryWorkspace from './store/StoreFinanceHistoryWorkspace';
import StoreFinancePeriodRuntime from './store/StoreFinancePeriodRuntime';
import StoreMercadoPagoPeriodSummaryWorkspace from './store/StoreMercadoPagoPeriodSummaryWorkspace';
import StoreResultsMarginsWorkspace from './store/StoreResultsMarginsWorkspace';

export function StoreFinanceCompositeRuntime({ storeId }: { storeId: string }) {
  return (
    <div className="space-y-4">
      <StoreFinancePeriodRuntime storeId={storeId} />
      <StoreResultsMarginsWorkspace storeId={storeId} />
      <StoreMercadoPagoPeriodSummaryWorkspace storeId={storeId} />
      <StoreFinanceHistoryWorkspace storeId={storeId} />
      <StoreFinanceRuntime storeId={storeId} />
      <section className="rounded-3xl border border-cyan-500/20 bg-slate-900 p-5"
        data-kyrub-cash-management-section="device-inventory">
        <h3 className="text-xs font-black uppercase text-white">Caixa operacional</h3>
        <StoreCashDeviceInventory storeId={storeId} />
      </section>
    </div>
  );
}
