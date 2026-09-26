import { StoreFinanceRuntime } from './StoreFinanceRuntime';
import StoreFinanceHistoryWorkspace from './store/StoreFinanceHistoryWorkspace';
import StoreFinancePeriodRuntime from './store/StoreFinancePeriodRuntime';
import StoreMercadoPagoPeriodSummaryWorkspace from './store/StoreMercadoPagoPeriodSummaryWorkspace';

export function StoreFinanceCompositeRuntime({ storeId }: { storeId: string }) {
  return (
    <div className="space-y-4">
      <StoreFinancePeriodRuntime storeId={storeId} />
      <StoreMercadoPagoPeriodSummaryWorkspace storeId={storeId} />
      <StoreFinanceHistoryWorkspace storeId={storeId} />
      <StoreFinanceRuntime storeId={storeId} />
    </div>
  );
}
