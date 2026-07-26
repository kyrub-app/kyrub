import type { User } from 'firebase/auth';
import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { parsePublicProducts } from './publicProducts';

export const removePublicProduct = async (
  user: Pick<User, 'uid'>,
  productId: string
): Promise<void> => {
  const normalizedProductId = productId.trim();
  if (!user.uid || !normalizedProductId) {
    throw new Error('O item não foi identificado para exclusão.');
  }

  const tenantReference = doc(db, 'tenants', user.uid);

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(tenantReference);
    if (!snapshot.exists()) {
      throw new Error('A loja não foi encontrada para excluir este item.');
    }

    const currentProducts = parsePublicProducts(snapshot.data().publicProducts);
    const product = currentProducts.find(item => item.id === normalizedProductId);

    if (!product) return;
    if (product.storeId !== user.uid || product.supplierId !== user.uid) {
      throw new Error('Este item não pertence à loja autenticada.');
    }

    transaction.set(
      tenantReference,
      {
        publicProducts: currentProducts.filter(
          item => item.id !== normalizedProductId
        ),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
};
