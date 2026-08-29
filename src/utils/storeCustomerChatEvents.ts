export const OPEN_STORE_CUSTOMER_CHAT_EVENT = 'kyrub:open-store-customer-chat';

export interface OpenStoreCustomerChatDetail {
  perspective: 'customer' | 'store';
  storeId: string;
  customerId?: string;
  storeName?: string;
  customerName?: string;
  orderId?: string;
}

export const openStoreCustomerChat = (
  detail: OpenStoreCustomerChatDetail
): void => {
  window.dispatchEvent(
    new CustomEvent<OpenStoreCustomerChatDetail>(
      OPEN_STORE_CUSTOMER_CHAT_EVENT,
      { detail }
    )
  );
};
