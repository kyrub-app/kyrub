/**
 * Kyrub Payment Split Controller & Compliance Ledger
 * Computes payment splits (supplier, retailer, platform) and writes immutable audit records to Firestore.
 */
import { 
  addDoc, 
  collection, 
  Firestore, 
  Timestamp 
} from 'firebase/firestore';
import { logExternalAPIFailure } from './observability';

export interface SplitResult {
  orderId: string;
  totalAmount: number;
  platformCommission: number; // 10% on B2C, or custom
  supplierAmount: number;     // wholesale due (if imported)
  retailerAmount: number;     // net remaining
}

export interface PaymentAuditLog {
  id: string;
  timestamp: string;
  orderId: string;
  tenantId: string;
  preSplitState: {
    total: number;
    items: any[];
    buyerEmail: string;
  };
  postSplitState: SplitResult;
  metadata: {
    paymentMethod: string;
    b2bInvolved: boolean;
    platformRate: number;
  };
}

/**
 * Calculates payment split for a retail B2C order.
 * If the product was imported from a B2B supplier, the supplier receives their wholesale price,
 * the platform takes its 10% commission on retail price, and the retailer gets the rest.
 */
export function calculatePaymentSplit(
  orderId: string,
  totalAmount: number,
  items: any[],
  platformRate: number = 0.10 // 10% default
): SplitResult {
  let supplierAmount = 0;

  // Compute wholesale sum due to suppliers
  items.forEach(item => {
    if (item.wholesalePrice && item.quantity) {
      supplierAmount += item.wholesalePrice * item.quantity;
    } else if (item.productId && item.productId.startsWith('p-r') && item.wholesalePrice) {
      supplierAmount += item.wholesalePrice * item.quantity;
    }
  });

  const platformCommission = Number((totalAmount * platformRate).toFixed(2));
  
  // Net retailer share is the remainder
  let retailerAmount = totalAmount - platformCommission - supplierAmount;
  if (retailerAmount < 0) {
    // Prevent negative balance (should not happen under standard markup rules)
    retailerAmount = 0;
  }

  return {
    orderId,
    totalAmount,
    platformCommission,
    supplierAmount: Number(supplierAmount.toFixed(2)),
    retailerAmount: Number(retailerAmount.toFixed(2))
  };
}

/**
 * Processes payment split, charges gateway, and writes an immutable audit record to Firestore
 */
export async function processPaymentAndLogAudit(
  db: any, // Firestore or mock db
  tenantId: string,
  orderId: string,
  totalAmount: number,
  items: any[],
  buyerEmail: string,
  paymentMethod: string = 'credit_card'
): Promise<{ success: boolean; split: SplitResult; auditLog?: PaymentAuditLog; error?: string }> {
  
  // 1. Calculate Split
  const hasWholesale = items.some(item => !!item.wholesalePrice || (item.productId && item.productId.includes('b2b')));
  const split = calculatePaymentSplit(orderId, totalAmount, items);

  const preSplitState = {
    total: totalAmount,
    items: items.map(i => ({ productId: i.productId, name: i.name, price: i.price, quantity: i.quantity })),
    buyerEmail
  };

  const metadata = {
    paymentMethod,
    b2bInvolved: hasWholesale,
    platformRate: 0.10
  };

  const auditRecord: Omit<PaymentAuditLog, 'id'> = {
    timestamp: new Date().toISOString(),
    orderId,
    tenantId,
    preSplitState,
    postSplitState: split,
    metadata
  };

  try {
    // Simulate payment processor call (e.g. BaaS gateway trigger)
    const isMockGatewaySuccessful = true; // Simulating payment success
    if (!isMockGatewaySuccessful) {
      throw new Error("BaaS Split payment API returned timeout.");
    }

    // 2. Write Immutable Audit Log to Firestore
    if (!db || typeof db.collection !== 'function') {
      // Browserside sandbox fallback
      console.log("[PaymentController] Saving IMMUTABLE audit log locally in Sandbox Mode:", auditRecord);
      const mockSavedLog: PaymentAuditLog = {
        id: `aud-${Date.now()}`,
        ...auditRecord
      };
      return { success: true, split, auditLog: mockSavedLog };
    }

    // REAL FIRESTORE WRITING
    const auditLogsCollectionRef = collection(db, `tenants/${tenantId}/audit_logs`);
    const docRef = await addDoc(auditLogsCollectionRef, {
      ...auditRecord,
      timestamp: Timestamp.now() // Use Firestore server timestamp
    });

    const savedLog: PaymentAuditLog = {
      id: docRef.id,
      ...auditRecord
    };

    return { success: true, split, auditLog: savedLog };

  } catch (err: any) {
    const errorMsg = err.message || String(err);
    // Central Observability logging of BaaS gateway issues
    logExternalAPIFailure(
      'baasController',
      'GATEWAY_ERROR',
      'https://api.bancofator.com.br/v2/split',
      { preSplitState, split },
      `Failed to process splits & log audits on Firestore: ${errorMsg}`,
      500,
      'critical'
    );

    return { success: false, split, error: errorMsg };
  }
}
