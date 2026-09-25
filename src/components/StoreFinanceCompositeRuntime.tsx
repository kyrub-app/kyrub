import { StoreFinanceRuntime } from './StoreFinanceRuntime';
import StoreFinancePeriodWorkspace from './store/StoreFinancePeriodWorkspace';

export function StoreFinanceCompositeRuntime({ storeId }: { storeId: string }) {
  return (
    <div className="space-y-4">
      <StoreFinancePeriodWorkspace storeId={storeId} />
      <StoreFinanceRuntime storeId={storeId} />
    </div>
  );
}
