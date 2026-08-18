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

export type KyrubErpInventoryItemSummary = {
  id: string;
  name: string;
  unit: 'un' | 'kg' | 'g' | 'l' | 'ml';
  currentQuantity: number;
  minimumQuantity: number;
  purchaseCost: number;
  supplier: string;
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
  orders: boolean;
};

export type KyrubErpContextSnapshot = {
  source: KyrubErpContextSource;
  generatedAt: string;
  store: KyrubErpStoreSummary | null;
  products: KyrubErpProductSummary[];
  productCount: number;
  productsTruncated: boolean;
  inventoryItems?: KyrubErpInventoryItemSummary[];
  inventoryItemCount?: number;
  inventoryTruncated?: boolean;
  pendingOrders: KyrubErpOrderSummary[];
  pendingOrderCount: number;
  ordersTruncated: boolean;
  lowStockThreshold: number;
  availability: KyrubErpReadAvailability;
  warnings: string[];
};
