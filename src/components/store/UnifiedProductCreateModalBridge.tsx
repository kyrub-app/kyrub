import { useEffect, useState } from 'react';
import type { Product } from '../../types';
import {
  OPEN_PRODUCT_CREATE_MODAL_EVENT,
  type ProductCreateModalDetail,
} from '../../utils/productModalEvents';
import {
  PUBLIC_PRODUCT_CREATE_EVENT,
  type PublicProduct,
  type PublicProductCreateRequest,
} from '../../utils/publicProducts';
import { ProductEditorModal } from './ProductEditorModal';

export function UnifiedProductCreateModalBridge() {
  const [isOpen, setIsOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleOpen = (event: Event): void => {
      const detail = (event as CustomEvent<ProductCreateModalDetail>).detail;
      setProducts(detail?.products ?? []);
      setKeywords(detail?.keywords ?? []);
      setSaving(false);
      setIsOpen(true);
    };

    window.addEventListener(OPEN_PRODUCT_CREATE_MODAL_EVENT, handleOpen);
    return () =>
      window.removeEventListener(OPEN_PRODUCT_CREATE_MODAL_EVENT, handleOpen);
  }, []);

  const handleSave = async (product: Product): Promise<void> => {
    const request: PublicProductCreateRequest = {
      product: product as PublicProduct,
      accepted: false,
    };

    setSaving(true);
    try {
      window.dispatchEvent(
        new CustomEvent<PublicProductCreateRequest>(PUBLIC_PRODUCT_CREATE_EVENT, {
          detail: request,
        })
      );
      if (!request.accepted) {
        throw new Error(
          request.reason ?? 'Não foi possível cadastrar este item nesta loja.'
        );
      }
      setIsOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProductEditorModal
      isOpen={isOpen}
      mode="create"
      product={null}
      products={products}
      keywords={keywords}
      isSaving={saving}
      onClose={() => !saving && setIsOpen(false)}
      onSave={handleSave}
    />
  );
}
