import type { Product } from '../types';

export const OPEN_PRODUCT_CREATE_MODAL_EVENT = 'kyrub-open-product-create-modal';

export interface ProductCreateModalDetail {
  products: Product[];
  keywords: string[];
}

export const requestProductCreateModal = (
  products: Product[],
  keywords: string[]
): void => {
  window.dispatchEvent(
    new CustomEvent<ProductCreateModalDetail>(OPEN_PRODUCT_CREATE_MODAL_EVENT, {
      detail: {
        products: [...products],
        keywords: [...keywords],
      },
    })
  );
};
