export type FinancialProfileStatus =
  | 'not_started'
  | 'pending_kyc'
  | 'active'
  | 'restricted'
  | 'disabled';

export type FinancialParticipantRole =
  | 'payer'
  | 'merchant'
  | 'courier'
  | 'freelancer'
  | 'professional'
  | 'affiliate'
  | 'supplier'
  | 'platform'
  | 'government'
  | 'other';

export type FinancialProviderBindingStatus =
  | 'pending'
  | 'active'
  | 'restricted'
  | 'disabled';

export interface FinancialProviderBinding {
  providerId: string;
  environment: 'sandbox' | 'production';
  recipientId?: string;
  accountId?: string;
  status: FinancialProviderBindingStatus;
}

/**
 * One financial identity per Kyrub user. Business roles are transaction context,
 * not separate financial identities. A user may be a buyer today and a merchant,
 * courier or freelancer in another transaction without creating a second profile.
 */
export interface KyrubFinancialProfile {
  userId: string;
  status: FinancialProfileStatus;
  providerBindings: FinancialProviderBinding[];
}

export type KyrubFinancialTransactionPurpose =
  | 'marketplace_order'
  | 'delivery'
  | 'freelance_service'
  | 'professional_service'
  | 'supplier_payment'
  | 'transfer'
  | 'refund'
  | 'other';

export type KyrubFinancialTransactionStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export type KyrubAllocationStatus =
  | 'planned'
  | 'blocked'
  | 'payable'
  | 'settled'
  | 'cancelled';

export interface KyrubTransactionAllocation {
  allocationId: string;
  recipientUserId: string;
  role: FinancialParticipantRole;
  amount: number;
  currency: 'BRL';
  status: KyrubAllocationStatus;
}

/**
 * Generic 1 payer -> N allocations contract. It deliberately does not assume that
 * a payment belongs to a store, delivery or freelancer flow; those meanings live
 * in `purpose` and allocation roles.
 */
export interface KyrubFinancialTransaction {
  transactionId: string;
  payerUserId: string;
  purpose: KyrubFinancialTransactionPurpose;
  amount: number;
  currency: 'BRL';
  paymentMethod: string;
  providerId?: string;
  status: KyrubFinancialTransactionStatus;
  allocations: KyrubTransactionAllocation[];
}

export const calculateAllocationTotal = (
  allocations: ReadonlyArray<KyrubTransactionAllocation>
): number => allocations.reduce((total, allocation) => total + allocation.amount, 0);

export const assertValidFinancialTransaction = (
  transaction: KyrubFinancialTransaction
): void => {
  if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) {
    throw new Error('FINANCIAL_TRANSACTION_INVALID_AMOUNT');
  }

  for (const allocation of transaction.allocations) {
    if (!Number.isFinite(allocation.amount) || allocation.amount < 0) {
      throw new Error('FINANCIAL_TRANSACTION_INVALID_ALLOCATION_AMOUNT');
    }
  }

  const allocated = calculateAllocationTotal(transaction.allocations);
  if (allocated > transaction.amount) {
    throw new Error('FINANCIAL_TRANSACTION_ALLOCATIONS_EXCEED_AMOUNT');
  }
};
