import type React from 'react';
import type { Product } from '../../types';
import {
  UnifiedProductModal,
  type ProductModalMode,
  type UnifiedProductModalProps,
} from './UnifiedProductModal';

interface ProductEditorModalProps
  extends Omit<UnifiedProductModalProps, 'isOpen' | 'mode' | 'product'> {
  isOpen?: boolean;
  mode?: ProductModalMode;
  product: Product | null;
}

export const ProductEditorModal: React.FC<ProductEditorModalProps> = ({
  isOpen,
  mode = 'edit',
  product,
  ...props
}) => (
  <UnifiedProductModal
    {...props}
    isOpen={isOpen ?? Boolean(product)}
    mode={mode}
    product={product}
  />
);

export type { ProductModalMode, UnifiedProductModalProps };
