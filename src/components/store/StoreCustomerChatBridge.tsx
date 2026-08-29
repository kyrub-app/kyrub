import { useEffect, useState } from 'react';
import {
  OPEN_STORE_CUSTOMER_CHAT_EVENT,
  type OpenStoreCustomerChatDetail,
} from '../../utils/storeCustomerChatEvents';
import { StoreCustomerChatModal } from './StoreCustomerChatModal';

export function StoreCustomerChatBridge() {
  const [detail, setDetail] = useState<OpenStoreCustomerChatDetail | null>(null);

  useEffect(() => {
    const handleOpen = (event: Event): void => {
      const customEvent = event as CustomEvent<OpenStoreCustomerChatDetail>;
      const next = customEvent.detail;
      if (!next?.storeId || (next.perspective === 'store' && !next.customerId)) {
        return;
      }
      setDetail(next);
    };
    window.addEventListener(OPEN_STORE_CUSTOMER_CHAT_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_STORE_CUSTOMER_CHAT_EVENT, handleOpen);
  }, []);

  if (!detail) return null;
  return <StoreCustomerChatModal detail={detail} onClose={() => setDetail(null)} />;
}
