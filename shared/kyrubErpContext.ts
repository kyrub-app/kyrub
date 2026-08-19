export type KyrubErpContextSource = 'authenticated_client_snapshot';

export type KyrubErpStoreSummary = {
  id: string;
  name: string;
  description: string;
  plan: 'free' | 'pro' | 'business';
  status: 'open' | 'delayed' | 'closed';
  address: string;
  keywords: string[];
  configured: boolean;
};

export type KyrubErpProductSummary = {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  isService: boolean;
  hasDescription: boolean;
  hasImage: boolean;
};

export type KyrubErpInventorySummary = {
  id: string;
  name: string;
  unit: 'un' | 'kg' | 'g' | 'l' | 'ml';
  currentQuantity: number;
  minimumQuantity: number;
  purchaseCost: number;
  supplier: string;
  updatedAt: string;
};

export type KyrubErpInventoryMovementLine = {
  itemId: string;
  name: string;
  unit: KyrubErpInventorySummary['unit'];
  quantityDelta: number;
  previousQuantity: number;
  resultingQuantity: number;
};

export type KyrubErpInventoryMovementSummary = {
  id: string;
  kind: 'intake' | 'outflow' | 'loss' | 'correction';
  mode: 'increment' | 'decrement' | 'set';
  sourceKind: string;
  sourceLabel: string;
  entryCount: number;
  createdAt: string;
  lines: KyrubErpInventoryMovementLine[];
  linesTruncated: boolean;
};

export type KyrubErpOrderSummary = {
  id: string;
  status: string;
  paymentStatus: string;
  fulfillmentType: string;
  total: number;
  itemCount: number;
  createdAt: string;
};

export type KyrubErpReadAvailability = {
  store: boolean;
  products: boolean;
  inventory?: boolean;
  inventoryMovements?: boolean;
  orders: boolean;
};

export type KyrubErpContextSnapshot = {
  source: KyrubErpContextSource;
  generatedAt: string;
  store: KyrubErpStoreSummary | null;
  products: KyrubErpProductSummary[];
  productCount: number;
  productsTruncated: boolean;
  inventory?: KyrubErpInventorySummary[];
  inventoryCount?: number;
  inventoryTruncated?: boolean;
  inventoryMovements?: KyrubErpInventoryMovementSummary[];
  inventoryMovementCount?: number;
  inventoryMovementsTruncated?: boolean;
  pendingOrders: KyrubErpOrderSummary[];
  pendingOrderCount: number;
  ordersTruncated: boolean;
  lowStockThreshold: number;
  availability: KyrubErpReadAvailability;
  warnings: string[];
};
