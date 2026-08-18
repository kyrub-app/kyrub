import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Product } from '../../types';
import { auth, db } from '../../utils/firebase';
import {
  EMPTY_PRODUCT_COMPOSITION,
  getProductInventoryDocumentPath,
  readProductInventorySettings,
  type InventoryCatalogItem,
  type ProductComposition,
} from '../../utils/productInventory';
import { ProductPricingPanel } from './ProductPricingPanel';

interface ProductPricingFieldsBridgeProps {
  isOpen: boolean;
  product: Product | null;
  isSaving: boolean;
}

const copyComposition = (value: ProductComposition): ProductComposition => ({
  ...value,
  lines: value.lines.map(line => ({ ...line })),
});

export function ProductPricingFieldsBridge({
  isOpen,
  product,
  isSaving,
}: ProductPricingFieldsBridgeProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [userId, setUserId] = useState('');
  const [catalog, setCatalog] = useState<InventoryCatalogItem[]>([]);
  const [composition, setComposition] = useState<ProductComposition>({
    ...EMPTY_PRODUCT_COMPOSITION,
    lines: [],
  });

  useEffect(() => {
    if (!isOpen || !product?.id) {
      setUserId('');
      setCatalog([]);
      setComposition({ ...EMPTY_PRODUCT_COMPOSITION, lines: [] });
      return;
    }

    let unsubscribeInventory = () => undefined;
    const unsubscribeAuth = auth.onAuthStateChanged(user => {
      unsubscribeInventory();
      unsubscribeInventory = () => undefined;
      setUserId(user?.uid ?? '');
      if (!user) return;

      unsubscribeInventory = onSnapshot(
        doc(db, getProductInventoryDocumentPath(user.uid)),
        snapshot => {
          const settings = readProductInventorySettings(snapshot.data());
          setCatalog(settings.catalog.map(item => ({ ...item })));
          setComposition(copyComposition(
            settings.compositions[product.id]
              ?? { ...EMPTY_PRODUCT_COMPOSITION, lines: [] }
          ));
        },
        error => {
          console.warn('Não foi possível atualizar a precificação pela ficha técnica.', error);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeInventory();
    };
  }, [isOpen, product?.id]);

  useEffect(() => {
    if (!isOpen || !product?.id) {
      setHost(null);
      return;
    }

    const decorate = () => {
      const modal = document.getElementById('unified-product-modal');
      const inventoryTab = modal?.querySelector<HTMLElement>('#product-inventory-tab');
      if (!inventoryTab) {
        setHost(current => current?.isConnected ? current : null);
        return;
      }

      let nextHost = inventoryTab.querySelector<HTMLElement>(
        '[data-kyrub-product-pricing-host]'
      );
      if (!nextHost) {
        nextHost = document.createElement('div');
        nextHost.dataset.kyrubProductPricingHost = 'true';
        inventoryTab.appendChild(nextHost);
      }
      setHost(current => current === nextHost ? current : nextHost);
    };

    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document
        .querySelectorAll<HTMLElement>('[data-kyrub-product-pricing-host]')
        .forEach(element => element.remove());
    };
  }, [isOpen, product?.id]);

  if (!host || !product?.id || !userId) return null;

  return createPortal(
    <ProductPricingPanel
      userId={userId}
      productId={product.id}
      catalog={catalog}
      composition={composition}
      currentSalePrice={Number.isFinite(product.price) ? product.price : null}
      disabled={isSaving}
    />,
    host
  );
}
