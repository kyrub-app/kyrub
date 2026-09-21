import { registerTablePayment as registerLegacyTablePayment } from './legacyTableOperations';

export {
  getActiveTableOrders,
  getTableOpenLines,
  getTableOutstandingTotal,
  buildStaffTableOrder,
  createStaffTableOrder,
  applyTablePaymentSelections,
  applyTableTransferSelections,
  transferTableItems,
  registerTablePartialPayment,
  applyTableCoupon,
  subscribeTableSettlementHistory,
  excludeTableItem,
  getTablePaymentMethodLabel,
} from './legacyTableOperations';

export type {
  StaffTableCartItem,
  BuildStaffTableOrderInput,
  TableItemSelection,
  TableOpenLine,
  AppliedTablePayment,
  AppliedTableTransfer,
  TableItemExclusionReceipt,
  TableSettlementEntry,
} from './legacyTableOperations';

export type TablePaymentMethod = 'cash' | 'pix' | 'card' | 'other';

// Compatibilidade preservada em legacyTableOperations.ts:
// public/data/tablePayments
// paidQuantity: item.paidQuantity + selectedQuantity

export const registerTablePayment: typeof registerLegacyTablePayment = async (
  user,
  input
) => {
  if (input.method === 'pix') {
    throw new Error(
      'Pix processado pelo Kyrub não pode ser baixado como recebimento manual. Abra a cobrança Pix canônica para gerar o QR Code e aguarde a confirmação do provedor.'
    );
  }
  return registerLegacyTablePayment(user, input);
};
