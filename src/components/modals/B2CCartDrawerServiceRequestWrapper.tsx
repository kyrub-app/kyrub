import { useEffect, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { CustomerLocalServiceRequestActions } from '../customer/CustomerLocalServiceRequestActions';
import { auth } from '../../utils/firebase';
import {
  loadLastCustomerOrderId,
  subscribeToCustomerOrder,
  type CustomerOrder,
} from '../../utils/customerOrders';
import { B2CCartDrawer as CoreB2CCartDrawer } from './B2CCartDrawer';

type Props = React.ComponentProps<typeof CoreB2CCartDrawer>;

export const B2CCartDrawerServiceRequestWrapper: React.FC<Props> = props => {
  const { isOpen, visitingStore } = props;
  const [currentOrder, setCurrentOrder] = useState<CustomerOrder | null>(null);
  const [orderHost, setOrderHost] = useState<HTMLElement | null>(null);
  const [accountHost, setAccountHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setCurrentOrder(null);
    if (!isOpen || !visitingStore) return;
    const user = auth.currentUser;
    if (!user) return;
    const orderId = loadLastCustomerOrderId(localStorage, user.uid, visitingStore.id);
    if (!orderId) return;
    return subscribeToCustomerOrder(
      visitingStore.id,
      orderId,
      setCurrentOrder,
      error => console.warn('Chamados do atendimento indisponíveis.', error)
    );
  }, [isOpen, visitingStore?.id]);

  useEffect(() => {
    if (!isOpen) {
      setOrderHost(null);
      setAccountHost(null);
      return;
    }
    let disposed = false;
    let orderPortal: HTMLDivElement | null = null;
    let accountPortal: HTMLDivElement | null = null;

    const install = (): void => {
      if (disposed) return;
      const orderPanel = document.getElementById('customer-order-panel');
      const accountPanel = document.getElementById('customer-account-panel');

      if (orderPanel instanceof HTMLElement && !orderPortal?.isConnected) {
        orderPortal = document.createElement('div');
        orderPortal.id = 'customer-order-service-request-host';
        orderPortal.className = 'mt-4';
        orderPanel.appendChild(orderPortal);
        setOrderHost(orderPortal);
      }
      if (accountPanel instanceof HTMLElement && !accountPortal?.isConnected) {
        accountPortal = document.createElement('div');
        accountPortal.id = 'customer-account-close-request-host';
        accountPortal.className = 'mt-4';
        accountPanel.appendChild(accountPortal);
        setAccountHost(accountPortal);
      }
    };

    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      disposed = true;
      observer.disconnect();
      orderPortal?.remove();
      accountPortal?.remove();
      setOrderHost(null);
      setAccountHost(null);
    };
  }, [isOpen]);

  return (
    <>
      <CoreB2CCartDrawer {...props} />
      {currentOrder && visitingStore && orderHost && createPortal(
        <CustomerLocalServiceRequestActions
          storeId={visitingStore.id}
          order={currentOrder}
          kind="assistance"
        />,
        orderHost
      )}
      {currentOrder && visitingStore && accountHost && createPortal(
        <CustomerLocalServiceRequestActions
          storeId={visitingStore.id}
          order={currentOrder}
          kind="close_account"
        />,
        accountHost
      )}
    </>
  );
};