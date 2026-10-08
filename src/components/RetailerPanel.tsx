import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { RetailerPanel as LegacyRetailerPanel } from './LegacyRetailerPanel';
import { CustomerOrderInbox } from './customer/CustomerOrderInbox';
import { AttendanceOrderApproval } from './customer/AttendanceOrderApproval';
import { CustomerTableBoard } from './customer/CustomerTableBoard';
import { TableServiceWorkspace } from './customer/TableServiceWorkspace';
import { CashWorkspace } from './store/CashWorkspace';
import { StorePaidWaitingFundingResponsibilityCard } from './store/StorePaidWaitingFundingResponsibilityCard';
import { OperationalDualWriteBridge } from './store/OperationalDualWriteBridge';
import { StoreDeliveryTrackingBridge } from './store/StoreDeliveryTrackingBridge';
import { auth } from '../utils/firebase';
import type { StoreRole } from '../utils/storeSecurity';
import {
  KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT,
  KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT,
  readCanonicalOrderNavigation,
  type CanonicalOrderNavigationRequest,
} from '../utils/canonicalOrderNavigation';
import {
  persistPublicProduct,
  PUBLIC_PRODUCT_CREATE_EVENT,
  type PublicProduct,
  type PublicProductCreateRequest,
} from '../utils/publicProducts';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrder,
  type CustomerOrderStatus,
} from '../utils/customerOrders';
import { buildCustomerTableCards } from '../utils/customerTables';
import {
  isOrderVisibleInKds,
  updateOrderStatusWithDecision,
  type OrderDecision,
} from '../utils/orderWorkflow';

type RetailerPanelProps = React.ComponentProps<typeof LegacyRetailerPanel> & { accessRole?: StoreRole };

export const RetailerPanel: React.FC<RetailerPanelProps> = props => {
  const {
    activeRetailerId,
    activeStore,
    products,
    setProducts,
    triggerToast,
    activeSubTab,
    setActiveSubTab,
    atendimentoSpaces,
  } = props;

  const [ordersHost, setOrdersHost] = useState<HTMLElement | null>(null);
  const [tablesHost, setTablesHost] = useState<HTMLElement | null>(null);
  const [cashHost, setCashHost] = useState<HTMLElement | null>(null);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [canonicalNavigationOrderId, setCanonicalNavigationOrderId] = useState('');
  const [busyOrderId, setBusyOrderId] = useState('');
  const [selectedTableCode, setSelectedTableCode] = useState('');
  const tableCards = useMemo(
    () => buildCustomerTableCards(customerOrders),
    [customerOrders]
  );
  const kdsOrders = useMemo(
    () => customerOrders.filter(isOrderVisibleInKds),
    [customerOrders]
  );
  const canonicalNavigationOrderVisible = useMemo(
    () => Boolean(
      canonicalNavigationOrderId &&
      kdsOrders.some(order => order.id === canonicalNavigationOrderId)
    ),
    [canonicalNavigationOrderId, kdsOrders]
  );

  useEffect(() => {
    setCanonicalNavigationOrderId('');
  }, [activeRetailerId]);

  useEffect(() => {
    if (!canonicalNavigationOrderVisible) return;
    const frame = window.requestAnimationFrame(() => {
      setCanonicalNavigationOrderId('');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canonicalNavigationOrderVisible]);

  useEffect(() => {
    const handleCanonicalOrderNavigation = (event: Event): void => {
      const detail = (event as CustomEvent<CanonicalOrderNavigationRequest>).detail;
      const user = auth.currentUser;
      if (
        !detail?.orderId?.trim() ||
        detail?.storeId?.trim() !== activeRetailerId ||
        !user
      ) {
        return;
      }
      setCanonicalNavigationOrderId(detail.orderId.trim());
      setActiveSubTab('pedidos');
    };

    window.addEventListener(
      KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT,
      handleCanonicalOrderNavigation
    );
    return () => {
      window.removeEventListener(
        KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT,
        handleCanonicalOrderNavigation
      );
    };
  }, [activeRetailerId, setActiveSubTab]);

  useEffect(() => {
    const syncCanonicalOrderNavigation = (): void => {
      const user = auth.currentUser;
      if (!user || user.uid !== activeRetailerId) {
        setCanonicalNavigationOrderId('');
        return;
      }
      setCanonicalNavigationOrderId(
        readCanonicalOrderNavigation(activeRetailerId)?.orderId ?? ''
      );
    };

    syncCanonicalOrderNavigation();
    window.addEventListener(
      KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT,
      syncCanonicalOrderNavigation
    );
    return () => {
      window.removeEventListener(
        KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT,
        syncCanonicalOrderNavigation
      );
    };
  }, [activeRetailerId]);

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
    if (activeSubTab !== 'caixa') {
      setCashHost(null);
      return;
    }

    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;

    const mountCashWorkspace = (): void => {
      if (cancelled) return;
      const cashContainer = document.getElementById('erp-caixa-tab');

      if (!cashContainer) {
        timer = window.setTimeout(mountCashWorkspace, 40);
        return;
      }

      cashContainer.innerHTML = '';
      cashContainer.className = '';
      portalHost = document.createElement('div');
      portalHost.id = 'kyrub-canonical-cash-workspace-host';
      portalHost.className = 'min-w-0';
      cashContainer.appendChild(portalHost);
      setCashHost(portalHost);
    };

    timer = window.setTimeout(mountCashWorkspace, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      portalHost?.remove();
      setCashHost(null);
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
    if (!user) {
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
    status: CustomerOrderStatus,
    decision?: OrderDecision
  ): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      triggerToast('Faça login novamente para atualizar o pedido.', 'error');
      return;
    }

    setBusyOrderId(order.id);

    try {
      await updateOrderStatusWithDecision(
        activeRetailerId,
        order.id,
        status,
        decision
      );
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
      <OperationalDualWriteBridge
        legacyStoreId={activeRetailerId}
        notify={triggerToast}
      />
      <LegacyRetailerPanel {...props} />

      {tablesHost &&
        createPortal(
          <CustomerTableBoard
            orders={customerOrders}
            onOpenTable={handleOpenTable}
          />,
          tablesHost
        )}
      {cashHost &&
        createPortal(
          <div>
            <StorePaidWaitingFundingResponsibilityCard />
            <CashWorkspace
              legacyStoreId={activeRetailerId}
              notify={triggerToast}
            />
          </div>,
          cashHost
        )}


      {ordersHost &&
        createPortal(
          <>
            <StoreDeliveryTrackingBridge storeId={activeRetailerId} />
            {canonicalNavigationOrderId && !canonicalNavigationOrderVisible && (
              <div
                id="kyrub-canonical-order-location-pending"
                className="mb-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.055] px-4 py-3 text-[10px] leading-relaxed text-cyan-100"
                role="status"
              >
                <strong className="block text-cyan-200">Localizando pedido canônico</strong>
                <span className="mt-1 block">
                  O Kyrub está aguardando o pedido {canonicalNavigationOrderId} aparecer nesta visão em tempo real. Nenhum outro pedido será escolhido por nome, cliente, SKU ou similaridade.
                </span>
              </div>
            )}
            <CustomerOrderInbox
              storeId={activeRetailerId}
              orders={kdsOrders}
              busyOrderId={busyOrderId}
              attendanceSpaces={atendimentoSpaces}
              onChangeStatus={handleChangeOrderStatus}
            />
          </>,
          ordersHost
        )}
      {selectedTableCode && (
        <>
          <TableServiceWorkspace
            storeId={activeRetailerId}
            tableCode={selectedTableCode}
            products={products}
            orders={customerOrders}
            onClose={() => setSelectedTableCode('')}
            notify={triggerToast}
          />
          <AttendanceOrderApproval
            storeId={activeRetailerId}
            tableCode={selectedTableCode}
            orders={customerOrders}
            notify={triggerToast}
          />
        </>
      )}

    </>
  );
};