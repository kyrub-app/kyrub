import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { RetailerPanel as LegacyRetailerPanel } from './LegacyRetailerPanel';
import { CustomerOrderInbox } from './customer/CustomerOrderInbox';
import { CustomerTableBoard } from './customer/CustomerTableBoard';
import { TableServiceWorkspace } from './customer/TableServiceWorkspace';
import { StoreTeamWorkspace } from './store/StoreTeamWorkspace';
import { auth } from '../utils/firebase';
import {
  persistPublicProduct,
  PUBLIC_PRODUCT_CREATE_EVENT,
  type PublicProductCreateRequest,
} from '../utils/publicProducts';
import {
  subscribeToStoreCustomerOrders,
  updateCustomerOrderStatus,
  type CustomerOrder,
  type CustomerOrderStatus,
} from '../utils/customerOrders';
import { buildCustomerTableCards } from '../utils/customerTables';

type RetailerPanelProps = React.ComponentProps<typeof LegacyRetailerPanel>;

export const RetailerPanel: React.FC<RetailerPanelProps> = props => {
  const {
    activeRetailerId,
    activeStore,
    products,
    setProducts,
    triggerToast,
    activeSubTab,
  } = props;

  const [ordersHost, setOrdersHost] = useState<HTMLElement | null>(null);
  const [tablesHost, setTablesHost] = useState<HTMLElement | null>(null);
  const [teamHost, setTeamHost] = useState<HTMLElement | null>(null);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [busyOrderId, setBusyOrderId] = useState('');
  const [selectedTableCode, setSelectedTableCode] = useState('');
  const tableCards = useMemo(
    () => buildCustomerTableCards(customerOrders),
    [customerOrders]
  );

  useEffect(() => {
    const handlePublicProductCreate = (event: Event): void => {
      const customEvent = event as CustomEvent<PublicProductCreateRequest>;
      const request = customEvent.detail;
      const product = request?.product;

      if (!request || !product) return;
      if (product.storeId !== activeRetailerId) return;

      const user = auth.currentUser;
      if (!user || user.uid !== activeRetailerId) {
        request.reason = 'Faça login novamente para cadastrar o item.';
        return;
      }

      const currentStoreProducts = products.filter(
        item =>
          item.supplierId === activeRetailerId &&
          item.wholesalePrice === undefined
      );

      if (activeStore.plan === 'free' && currentStoreProducts.length >= 5) {
        request.reason =
          'O plano gratuito permite até 5 produtos ou serviços por loja.';
        return;
      }

      request.accepted = true;
      setProducts(previous => [
        product,
        ...previous.filter(item => item.id !== product.id),
      ]);

      void persistPublicProduct(user, product)
        .then(() => {
          triggerToast(
            `“${product.name}” foi cadastrado e publicado na vitrine.`,
            'success'
          );
        })
        .catch(error => {
          console.error('Falha ao publicar o produto da loja:', error);
          triggerToast(
            `“${product.name}” ficou salvo neste dispositivo, mas ainda não foi publicado.`,
            'error'
          );
        });
    };

    window.addEventListener(
      PUBLIC_PRODUCT_CREATE_EVENT,
      handlePublicProductCreate
    );

    return () => {
      window.removeEventListener(
        PUBLIC_PRODUCT_CREATE_EVENT,
        handlePublicProductCreate
      );
    };
  }, [
    activeRetailerId,
    activeStore.plan,
    products,
    setProducts,
    triggerToast,
  ]);

  useEffect(() => {
    if (activeSubTab !== 'pedidos') {
      setOrdersHost(null);
      return;
    }

    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;

    const mountOrderInbox = (): void => {
      if (cancelled) return;
      const legacyContainer = document.getElementById('kds-funnel-view');

      if (!legacyContainer) {
        timer = window.setTimeout(mountOrderInbox, 40);
        return;
      }

      legacyContainer.innerHTML = '';
      legacyContainer.className = '';
      portalHost = document.createElement('div');
      portalHost.id = 'kyrub-customer-order-inbox-host';
      legacyContainer.appendChild(portalHost);
      setOrdersHost(portalHost);
    };

    timer = window.setTimeout(mountOrderInbox, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      portalHost?.remove();
      setOrdersHost(null);
    };
  }, [activeSubTab]);

  useEffect(() => {
    if (activeSubTab !== 'clientes') {
      setTablesHost(null);
      return;
    }

    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;

    const mountTableBoard = (): void => {
      if (cancelled) return;
      const clientsContainer = document.getElementById('erp-clientes-tab');

      if (!clientsContainer) {
        timer = window.setTimeout(mountTableBoard, 40);
        return;
      }

      portalHost = document.createElement('div');
      portalHost.id = 'kyrub-customer-table-board-host';
      portalHost.className = 'min-w-0';
      const insertionTarget = clientsContainer.children.item(2);
      clientsContainer.insertBefore(portalHost, insertionTarget ?? null);
      setTablesHost(portalHost);
    };

    timer = window.setTimeout(mountTableBoard, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      portalHost?.remove();
      setTablesHost(null);
    };
  }, [activeSubTab]);

  useEffect(() => {
    if (activeSubTab !== 'gerencial') {
      setTeamHost(null);
      return;
    }

    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;

    const mountTeamWorkspace = (): void => {
      if (cancelled) return;
      const managementContainer = document.getElementById('erp-gerencial-tab');

      if (!managementContainer) {
        timer = window.setTimeout(mountTeamWorkspace, 40);
        return;
      }

      portalHost = document.createElement('div');
      portalHost.id = 'kyrub-store-team-workspace-host';
      portalHost.className = 'min-w-0';
      managementContainer.insertBefore(
        portalHost,
        managementContainer.firstChild
      );
      setTeamHost(portalHost);
    };

    timer = window.setTimeout(mountTeamWorkspace, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      portalHost?.remove();
      setTeamHost(null);
    };
  }, [activeSubTab]);

  useEffect(() => {
    if (activeSubTab !== 'clientes') return;
    const emptyState = document.getElementById('empty-clients');
    if (!emptyState) return;

    const previousDisplay = emptyState.style.display;
    emptyState.style.display = tableCards.length > 0 ? 'none' : previousDisplay;

    return () => {
      emptyState.style.display = previousDisplay;
    };
  }, [activeSubTab, tableCards.length]);

  useEffect(() => {
    const needsCustomerOrders =
      activeSubTab === 'clientes' ||
      activeSubTab === 'pedidos' ||
      selectedTableCode.length > 0;

    if (!needsCustomerOrders || !activeRetailerId) {
      setCustomerOrders([]);
      return;
    }

    const user = auth.currentUser;
    if (!user || user.uid !== activeRetailerId) {
      setCustomerOrders([]);
      return;
    }

    return subscribeToStoreCustomerOrders(
      activeRetailerId,
      orders => setCustomerOrders(orders),
      error => {
        console.warn('Pedidos do cliente indisponíveis.', error);
        triggerToast('Não foi possível carregar os pedidos da loja.', 'error');
      }
    );
  }, [activeRetailerId, activeSubTab, selectedTableCode, triggerToast]);

  const handleChangeOrderStatus = async (
    order: CustomerOrder,
    status: CustomerOrderStatus
  ): Promise<void> => {
    const user = auth.currentUser;
    if (!user || user.uid !== activeRetailerId) {
      triggerToast('Faça login novamente para atualizar o pedido.', 'error');
      return;
    }

    setBusyOrderId(order.id);

    try {
      await updateCustomerOrderStatus(activeRetailerId, order.id, status);
      triggerToast('Status do pedido atualizado.', 'success');
    } catch (error) {
      console.error('Falha ao atualizar pedido do cliente:', error);
      triggerToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível atualizar o pedido.',
        'error'
      );
    } finally {
      setBusyOrderId('');
    }
  };

  const handleOpenTable = (tableCode: string): void => {
    setSelectedTableCode(tableCode);
  };

  return (
    <>
      <LegacyRetailerPanel {...props} />
      {tablesHost &&
        createPortal(
          <CustomerTableBoard
            orders={customerOrders}
            onOpenTable={handleOpenTable}
          />,
          tablesHost
        )}
      {teamHost &&
        createPortal(
          <StoreTeamWorkspace
            legacyStore={activeStore}
            legacyStoreId={activeRetailerId}
            notify={triggerToast}
          />,
          teamHost
        )}
      {ordersHost &&
        createPortal(
          <CustomerOrderInbox
            orders={customerOrders}
            busyOrderId={busyOrderId}
            onChangeStatus={handleChangeOrderStatus}
          />,
          ordersHost
        )}
      {selectedTableCode && (
        <TableServiceWorkspace
          storeId={activeRetailerId}
          tableCode={selectedTableCode}
          products={products}
          orders={customerOrders}
          onClose={() => setSelectedTableCode('')}
          notify={triggerToast}
        />
      )}
    </>
  );
};
