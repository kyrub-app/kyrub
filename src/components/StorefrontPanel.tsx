import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { StorefrontPanel as LegacyStorefrontPanel } from './LegacyStorefrontPanel';
import {
  subscribeToPreferredPublicProducts,
  type PublicProduct,
} from '../utils/publicProducts';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrderStatus,
} from '../utils/customerOrders';
import {
  parseCatalogCustomizationDefaults,
  resolveCatalogCustomization,
  type CatalogCustomizationDefaults,
} from '../utils/catalogCustomizationInheritance';
import {
  listMarketplacePromotions,
  type PublicMarketplacePromotion,
} from '../utils/marketplaceCheckout';
import { db } from '../utils/firebase';

const KDS_ACTIVE_STATUSES = new Set<CustomerOrderStatus>([
  'pending',
  'accepted',
  'preparing',
  'ready',
]);

const CONFIRMED_SALE_STATUSES = new Set<CustomerOrderStatus>([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
]);

type StorefrontPanelProps = Omit<
  React.ComponentProps<typeof LegacyStorefrontPanel>,
  'activeKdsOrderCount' | 'salesByProductId'
>;

type AvailabilityResponse = {
  stockByProductId?: Record<string, unknown>;
};

const sourceProductId = (value: string): string =>
  value.split('::', 1)[0]?.trim() || value.trim();

const parseDerivedStock = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const response = value as AvailabilityResponse;
  const source = response.stockByProductId;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

  const next: Record<string, number> = {};
  for (const [productId, stock] of Object.entries(source)) {
    if (
      productId.trim() &&
      typeof stock === 'number' &&
      Number.isFinite(stock) &&
      stock >= 0
    ) {
      next[productId] = Math.floor(stock);
    }
  }
  return next;
};

const promotionPriority = (
  left: PublicMarketplacePromotion,
  right: PublicMarketplacePromotion
): number => {
  if (left.discountType !== right.discountType) {
    return left.discountType === 'percentage' ? -1 : 1;
  }
  if (left.discountValue !== right.discountValue) {
    return right.discountValue - left.discountValue;
  }
  return left.code.localeCompare(right.code);
};

export const StorefrontPanel: React.FC<StorefrontPanelProps> = props => {
  const storeId = props.activeConsumerStore?.id ?? '';
  const [publicProducts, setPublicProducts] = useState<PublicProduct[] | null>(
    null
  );
  const [publicPromotions, setPublicPromotions] = useState<
    PublicMarketplacePromotion[]
  >([]);
  const [customizationDefaults, setCustomizationDefaults] = useState<
    CatalogCustomizationDefaults[]
  >([]);
  const [activeKdsOrderCount, setActiveKdsOrderCount] = useState(0);
  const [salesByProductId, setSalesByProductId] = useState<Record<string, number>>(
    {}
  );
  const [derivedStockByProductId, setDerivedStockByProductId] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    setPublicProducts(null);

    if (!storeId) {
      setPublicProducts([]);
      return;
    }

    return subscribeToPreferredPublicProducts(
      storeId,
      result => setPublicProducts(result.products),
      error => {
        console.warn(
          'Leitura canônica de produtos indisponível; usando o catálogo legado.',
          error
        );
      }
    );
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;
    setPublicPromotions([]);
    if (!storeId) return;

    void listMarketplacePromotions(storeId)
      .then(promotions => {
        if (!cancelled) setPublicPromotions(promotions);
      })
      .catch(error => {
        if (!cancelled) {
          console.warn('Promoções públicas indisponíveis na vitrine.', error);
          setPublicPromotions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    setCustomizationDefaults([]);
    if (!storeId) return;

    return onSnapshot(
      doc(db, 'tenants', storeId),
      snapshot =>
        setCustomizationDefaults(
          parseCatalogCustomizationDefaults(
            snapshot.data()?.catalogCustomizationDefaults
          )
        ),
      error => {
        console.warn(
          'Padrões herdados do catálogo indisponíveis na vitrine.',
          error
        );
        setCustomizationDefaults([]);
      }
    );
  }, [storeId]);

  useEffect(() => {
    setActiveKdsOrderCount(0);
    setSalesByProductId({});
    if (!storeId) return;

    return subscribeToStoreCustomerOrders(
      storeId,
      orders => {
        setActiveKdsOrderCount(
          orders.filter(order => KDS_ACTIVE_STATUSES.has(order.status)).length
        );

        const nextSalesByProductId: Record<string, number> = {};
        for (const order of orders) {
          if (!CONFIRMED_SALE_STATUSES.has(order.status)) continue;
          for (const item of order.items) {
            const productId = sourceProductId(item.productId);
            nextSalesByProductId[productId] =
              (nextSalesByProductId[productId] ?? 0) + item.quantity;
          }
        }
        setSalesByProductId(nextSalesByProductId);
      },
      error => {
        console.warn('Carga atual do KDS indisponível para a vitrine.', error);
        setActiveKdsOrderCount(0);
        setSalesByProductId({});
      }
    );
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;
    setDerivedStockByProductId({});
    if (!storeId) return;

    const loadAvailability = async (): Promise<void> => {
      try {
        const response = await fetch(
          '/api/action-execute?transport=storefront-availability',
          {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ storeId }),
            cache: 'no-store',
          }
        );
        if (!response.ok) {
          throw new Error(`Disponibilidade HTTP ${response.status}`);
        }
        const payload = await response.json() as unknown;
        if (!cancelled) {
          setDerivedStockByProductId(parseDerivedStock(payload));
        }
      } catch (error) {
        if (!cancelled) {
          console.warn(
            'Disponibilidade derivada do estoque indisponível; usando o saldo público atual.',
            error
          );
          setDerivedStockByProductId({});
        }
      }
    };

    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [storeId, salesByProductId]);

  const localStoreProducts = useMemo(
    () =>
      props.products.filter(
        product =>
          product.supplierId === storeId && product.wholesalePrice === undefined
      ),
    [props.products, storeId]
  );

  const storefrontProducts = useMemo(
    () =>
      (publicProducts ?? localStoreProducts).map(product => {
        const resolved = resolveCatalogCustomization(
          product,
          customizationDefaults
        );
        const derivedStock = derivedStockByProductId[product.id];
        return {
          ...product,
          ...(typeof derivedStock === 'number' && !product.isService
            ? { stock: derivedStock }
            : {}),
          ...(resolved.quickNotes.length > 0
            ? { quickNotes: resolved.quickNotes }
            : { quickNotes: undefined }),
          ...(resolved.optionGroups.length > 0
            ? { optionGroups: resolved.optionGroups }
            : { optionGroups: undefined }),
        };
      }),
    [
      customizationDefaults,
      derivedStockByProductId,
      localStoreProducts,
      publicProducts,
    ]
  );

  const promotionByProductId = useMemo(() => {
    const next = new Map<string, PublicMarketplacePromotion>();
    const orderedPromotions = [...publicPromotions].sort(promotionPriority);
    for (const promotion of orderedPromotions) {
      for (const productId of promotion.productIds) {
        if (!next.has(productId)) next.set(productId, promotion);
      }
    }
    return next;
  }, [publicPromotions]);

  useEffect(() => {
    const cleanup = (): void => {
      document
        .querySelectorAll('.kyrub-storefront-promotion-badge')
        .forEach(node => node.remove());
    };

    cleanup();

    for (const product of storefrontProducts) {
      const promotion = promotionByProductId.get(product.id);
      if (!promotion) continue;

      const article = document.getElementById(`storefront-prod-${product.id}`);
      const imageContainer = article?.firstElementChild;
      if (!(imageContainer instanceof HTMLElement)) continue;

      const badge = document.createElement('span');
      badge.className =
        'kyrub-storefront-promotion-badge absolute right-2 top-2 z-10 max-w-[62%] rounded-lg border border-emerald-300/40 bg-emerald-500 px-2 py-1 text-right text-[8px] font-black uppercase leading-tight text-slate-950 shadow-lg sm:right-3 sm:top-3 sm:px-2.5 sm:text-[9px]';
      badge.dataset.promotionId = promotion.id;
      badge.dataset.couponCode = promotion.code;
      badge.title = `${promotion.title} · Cupom ${promotion.code}`;
      badge.setAttribute(
        'aria-label',
        `${promotion.badge}. Cupom ${promotion.code} disponível.`
      );

      const discountLine = document.createElement('strong');
      discountLine.className = 'block';
      discountLine.textContent = promotion.badge;

      const couponLine = document.createElement('span');
      couponLine.className = 'mt-0.5 block text-[7px] font-black sm:text-[8px]';
      couponLine.textContent = 'Cupom disponível';

      badge.append(discountLine, couponLine);
      imageContainer.appendChild(badge);
    }

    return cleanup;
  }, [promotionByProductId, storefrontProducts]);

  return (
    <LegacyStorefrontPanel
      {...props}
      products={storefrontProducts}
      activeKdsOrderCount={activeKdsOrderCount}
      salesByProductId={salesByProductId}
    />
  );
};
