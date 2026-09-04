import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { RetailerPanel as LegacyRetailerPanel } from './LegacyRetailerPanel';
import { CustomerOrderInbox } from './customer/CustomerOrderInbox';
import { AttendanceOrderApproval } from './customer/AttendanceOrderApproval';
import { CustomerTableBoard } from './customer/CustomerTableBoard';
import { TableServiceWorkspace } from './customer/TableServiceWorkspace';
import { CashWorkspace } from './store/CashWorkspace';
import { StorePaidWaitingFundingResponsibilityCard } from './store/StorePaidWaitingFundingResponsibilityCard';
import { OperationalDualWriteBridge } from './store/OperationalDualWriteBridge';
import { ProductEditorModal } from './store/ProductEditorModal';
import { ProductInventoryWorkspace } from './store/ProductInventoryWorkspace';
import { StoreDeliveryTrackingBridge } from './store/StoreDeliveryTrackingBridge';
import type { Product } from '../types';
import { auth } from '../utils/firebase';
import {
  KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT,
  type CanonicalOrderNavigationRequest,
} from '../utils/canonicalOrderNavigation';
import {
  persistPublicProduct,
  PUBLIC_PRODUCT_CREATE_EVENT,
  type PublicProduct,
  type PublicProductCreateRequest,
} from '../utils/publicProducts';
import { removePublicProduct } from '../utils/publicProductMutations';
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

type RetailerPanelProps = React.ComponentProps<typeof LegacyRetailerPanel>;

export const RetailerPanel: React.FC<RetailerPanelProps> = props => {
  const {
    activeRetailerId,
    activeStore,
    products,
    setProducts,
    setNewProductModal,
    triggerToast,
    activeSubTab,
    setActiveSubTab,
    atendimentoSpaces,
  } = props;

  const [ordersHost, setOrdersHost] = useState<HTMLElement | null>(null);
  const [tablesHost, setTablesHost] = useState<HTMLElement | null>(null);
  const [cashHost, setCashHost] = useState<HTMLElement | null>(null);
  const [productsHost, setProductsHost] = useState<HTMLElement | null>(null);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [canonicalNavigationOrderId, setCanonicalNavigationOrderId] = useState('');
  const [busyOrderId, setBusyOrderId] = useState('');
  const [selectedTableCode, setSelectedTableCode] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [busyProductId, setBusyProductId] = useState('');
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

  const activeRetailerProducts = useMemo(
    () =>
      products.filter(
        item =>
          item.supplierId === activeRetailerId &&
          item.wholesalePrice === undefined
      ),
    [activeRetailerId, products]
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
        !user ||
        user.uid !== activeRetailerId
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
    if (activeSubTab !== 'gerencial') {
      setProductsHost(null);
      return;
    }

    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;
    let legacyProductsGrid: HTMLElement | null = null;
    let previousDisplay = '';

    const synchronizeProductsWorkspace = (): void => {
      if (cancelled) return;

      if (portalHost && !portalHost.isConnected) {
        portalHost = null;
        legacyProductsGrid = null;
        previousDisplay = '';
        setProductsHost(null);
      }

      if (!portalHost) {
        const managementContainer = document.getElementById('erp-gerencial-tab');
        const appearanceHeading = Array.from(
          managementContainer?.querySelectorAll('h4') ?? []
        ).find(
          heading =>
            heading.textContent?.trim().toLocaleUpperCase('pt-BR') ===
            'APARÊNCIA DA VITRINE'
        );
        const candidateGrid = appearanceHeading?.closest('.grid');

        if (candidateGrid instanceof HTMLElement && candidateGrid.parentElement) {
          legacyProductsGrid = candidateGrid;
          previousDisplay = candidateGrid.style.display;
          candidateGrid.style.display = 'none';

          portalHost = document.createElement('div');
          portalHost.id = 'kyrub-product-inventory-workspace-host';
          portalHost.className = 'min-w-0';
          candidateGrid.parentElement.insertBefore(portalHost, candidateGrid);
          setProductsHost(portalHost);
        }
      }

      timer = window.setTimeout(synchronizeProductsWorkspace, 80);
    };

    timer = window.setTimeout(synchronizeProductsWorkspace, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (legacyProductsGrid?.isConnected) {
        legacyProductsGrid.style.display = previousDisplay;
      }
      portalHost?.remove();
      setProductsHost(null);
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
    status: CustomerOrderStatus,
    decision?: OrderDecision
  ): Promise<void> => {
    const user = auth.currentUser;
    if (!user || user.uid !== activeRetailerId) {
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

  const handleCreateProduct = (): void => {
    if (activeStore.plan === 'free' && activeRetailerProducts.length >= 5) {
      triggerToast(
        'O plano gratuito permite até 5 produtos ou serviços por loja.',
        'error'
      );
      return;
    }

    setNewProductModal(true);
  };

  const handleSaveProduct = async (product: Product): Promise<void> => {
    const user = auth.currentUser;
    if (!user || user.uid !== activeRetailerId) {
      throw new Error('Faça login novamente para atualizar o item.');
    }

    const previousProduct = products.find(item => item.id === product.id);
    const updatedProduct: PublicProduct = {
      ...product,
      storeId: user.uid,
      supplierId: user.uid,
      updatedAt: new Date().toISOString(),
    };

    setBusyProductId(product.id);
    setProducts(previous =>
      previous.map(item => item.id === product.id ? updatedProduct : item)
    );

    try {
      await persistPublicProduct(user, updatedProduct);
      setEditingProduct(null);
      triggerToast(`“${updatedProduct.name}” foi atualizado.`, 'success');
    } catch (error) {
      if (previousProduct) {
        setProducts(previous =>
          previous.map(item => item.id === product.id ? previousProduct : item)
        );
      }
      console.error('Falha ao atualizar produto:', error);
      throw new Error('Não foi possível salvar as alterações do item.');
    } finally {
      setBusyProductId('');
    }
  };

  const handleConfirmDeleteProduct = async (): Promise<void> => {
    const product = deletingProduct;
    const user = auth.currentUser;
    if (!product) return;
    if (!user || user.uid !== activeRetailerId) {
      triggerToast('Faça login novamente para excluir o item.', 'error');
      return;
    }

    setBusyProductId(product.id);
    setProducts(previous => previous.filter(item => item.id !== product.id));

    try {
      await removePublicProduct(user, product.id);
      setDeletingProduct(null);
      triggerToast(`“${product.name}” foi excluído do catálogo.`, 'success');
    } catch (error) {
      setProducts(previous =>
        previous.some(item => item.id === product.id)
          ? previous
          : [product, ...previous]
      );
      console.error('Falha ao excluir produto:', error);
      triggerToast('Não foi possível excluir o item.', 'error');
    } finally {
      setBusyProductId('');
    }
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
      {productsHost &&
        createPortal(
          <ProductInventoryWorkspace
            products={activeRetailerProducts}
            keywords={activeStore.keywords ?? []}
            onCreateProduct={handleCreateProduct}
            onEditProduct={setEditingProduct}
            onDeleteProduct={setDeletingProduct}
            busyProductId={busyProductId}
          />,
          productsHost
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

      <ProductEditorModal
        product={editingProduct}
        products={activeRetailerProducts}
        keywords={activeStore.keywords ?? []}
        isSaving={Boolean(busyProductId)}
        onClose={() => !busyProductId && setEditingProduct(null)}
        onSave={handleSaveProduct}
      />

      {deletingProduct && (
        <div className="fixed inset-0 z-[136] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section className="w-full max-w-md rounded-t-3xl border border-red-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/10 text-red-300">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div>
                  <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-red-300">
                    Excluir item
                  </span>
                  <h3 className="mt-1 text-lg font-black text-white">
                    Remover “{deletingProduct.name}”?
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                disabled={Boolean(busyProductId)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 disabled:opacity-40"
                aria-label="Fechar confirmação"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/[0.07] p-4 text-[10px] leading-relaxed text-red-100">
              O item deixará de aparecer no estoque e na vitrine. Pedidos antigos continuarão preservando o nome, o preço e as quantidades registrados no momento da venda.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                disabled={Boolean(busyProductId)}
                className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[10px] font-black uppercase text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteProduct()}
                disabled={Boolean(busyProductId)}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
                id="confirm-delete-product-button"
              >
                <Trash2 className="h-4 w-4" />
                {busyProductId ? 'Excluindo...' : 'Excluir item'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
};