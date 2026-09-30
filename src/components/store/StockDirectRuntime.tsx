import { StorePurchaseWorkspace } from './StorePurchaseWorkspace';

interface StockDirectRuntimeProps {
  storeId: string;
}

export function StockDirectRuntime({ storeId }: StockDirectRuntimeProps) {
  return (
    <div
      id="kyrub-stock-direct-runtime"
      data-kyrub-stock-native="true"
      className="space-y-4"
    >
      <StorePurchaseWorkspace storeId={storeId} />
    </div>
  );
}
