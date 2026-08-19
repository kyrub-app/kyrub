import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import {
  getCustomerOrderDocumentPath,
  parseCustomerOrder,
  type CustomerFulfillmentType,
  type CustomerOrderPaymentStatus,
  type CustomerOrderStatus,
} from '../utils/customerOrders';

export type KyrubOrderDetailItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  paidQuantity: number;
  transferredQuantity: number;
  note: string;
};

export type KyrubOrderDetails = {
  id: string;
  buyerName: string;
  fulfillmentType: CustomerFulfillmentType;
  deliveryAddress: string;
  tableCode: string;
  customerNote: string;
  items: KyrubOrderDetailItem[];
  subtotal: number;
  total: number;
  status: CustomerOrderStatus;
  paymentStatus: CustomerOrderPaymentStatus;
  source: 'customer' | 'staff' | 'transfer';
  operatorName: string;
  createdAt: string;
  updatedAt: string;
};

export const readKyrubOrderDetails = async (
  user: Pick<User, 'uid'>,
  orderId: string
): Promise<KyrubOrderDetails | null> => {
  const normalizedOrderId = orderId.trim();
  if (!normalizedOrderId || normalizedOrderId.includes('/') || normalizedOrderId.includes('..')) {
    throw new Error('Pedido não identificado.');
  }
  const snapshot = await getDoc(
    doc(db, getCustomerOrderDocumentPath(user.uid, normalizedOrderId))
  );
  const order = parseCustomerOrder(snapshot.data());
  if (!order || order.id !== normalizedOrderId || order.storeId !== user.uid) return null;

  return {
    id: order.id,
    buyerName: order.buyerName,
    fulfillmentType: order.fulfillmentType,
    deliveryAddress: order.deliveryAddress,
    tableCode: order.tableCode,
    customerNote: order.customerNote,
    items: order.items.map(item => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      paidQuantity: item.paidQuantity,
      transferredQuantity: item.transferredQuantity,
      note: item.note,
    })),
    subtotal: order.subtotal,
    total: order.total,
    status: order.status,
    paymentStatus: order.paymentStatus,
    source: order.source,
    operatorName: order.operatorName,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
};
