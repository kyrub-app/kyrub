import type { User } from 'firebase/auth';
import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import type { ProductCategoryCollection } from '../types';
import { db } from './firebase';
import {
  parsePublicProducts,
  type PublicProduct,
} from './publicProducts';

export const MAX_CATALOG_CATEGORY_LEVELS = 6;

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const normalizeCatalogCategoryValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

export const splitCatalogCategoryPath = (value: string): string[] =>
  value
    .split(/\s*(?:>|\/)\s*/)
    .map(segment => segment.trim())
    .filter(Boolean);

export const joinCatalogCategoryPath = (segments: string[]): string =>
  segments.map(segment => segment.trim()).filter(Boolean).join(' > ');

const normalizedPath = (value: string): string =>
  splitCatalogCategoryPath(value)
    .map(normalizeCatalogCategoryValue)
    .join(' > ');

const isPathPrefix = (candidate: string[], prefix: string[]): boolean =>
  candidate.length >= prefix.length &&
  prefix.every(
    (segment, index) =>
      normalizeCatalogCategoryValue(candidate[index] ?? '') ===
      normalizeCatalogCategoryValue(segment)
  );

const uniqueCollections = (
  collections: ProductCategoryCollection[]
): ProductCategoryCollection[] => {
  const byPath = new Map<string, ProductCategoryCollection>();

  for (const collection of collections) {
    const segments = splitCatalogCategoryPath(collection.path).slice(
      0,
      MAX_CATALOG_CATEGORY_LEVELS
    );
    if (segments.length <= 1) continue;

    const path = joinCatalogCategoryPath(segments);
    const key = normalizedPath(path);
    const existing = byPath.get(key);
    const image = cleanString(collection.image);

    if (!existing) {
      byPath.set(key, {
        path,
        name: segments.at(-1) ?? '',
        image,
      });
      continue;
    }

    if (!existing.image && image) {
      byPath.set(key, { ...existing, image });
    }
  }

  return [...byPath.values()].sort((left, right) => {
    const depthDifference =
      splitCatalogCategoryPath(left.path).length -
      splitCatalogCategoryPath(right.path).length;
    return depthDifference || left.path.localeCompare(right.path, 'pt-BR');
  });
};

export const parseCatalogCategoryPaths = (
  value: unknown
): ProductCategoryCollection[] => {
  if (!Array.isArray(value)) return [];

  return uniqueCollections(
    value.flatMap(candidate => {
      if (!candidate || typeof candidate !== 'object') return [];
      const record = candidate as Record<string, unknown>;
      const path = cleanString(record.path);
      const segments = splitCatalogCategoryPath(path);
      if (segments.length <= 1) return [];

      return [{
        path: joinCatalogCategoryPath(segments),
        name: cleanString(record.name) || segments.at(-1) || '',
        image: cleanString(record.image),
      } satisfies ProductCategoryCollection];
    })
  );
};

export const deriveCatalogCategoryPaths = (
  products: PublicProduct[]
): ProductCategoryCollection[] => {
  const collections: ProductCategoryCollection[] = [];

  for (const product of products) {
    const segments = splitCatalogCategoryPath(product.category).slice(
      0,
      MAX_CATALOG_CATEGORY_LEVELS
    );
    const productImages = new Map(
      (product.categoryCollections ?? []).map(collection => [
        normalizedPath(collection.path),
        collection.image.trim(),
      ])
    );

    for (let depth = 2; depth <= segments.length; depth += 1) {
      const path = joinCatalogCategoryPath(segments.slice(0, depth));
      collections.push({
        path,
        name: segments[depth - 1] ?? '',
        image: productImages.get(normalizedPath(path)) ?? '',
      });
    }
  }

  return uniqueCollections(collections);
};

export const mergeCatalogCategoryPaths = (
  storedPaths: ProductCategoryCollection[],
  products: PublicProduct[]
): ProductCategoryCollection[] =>
  uniqueCollections([
    ...storedPaths,
    ...deriveCatalogCategoryPaths(products),
  ]);

const collectionsSignature = (
  collections: ProductCategoryCollection[]
): string =>
  JSON.stringify(
    uniqueCollections(collections).map(collection => ({
      path: collection.path,
      image: collection.image,
    }))
  );

const transformPathForRename = (
  value: string,
  targetSegments: string[],
  nextName: string
): string => {
  const segments = splitCatalogCategoryPath(value);
  if (!isPathPrefix(segments, targetSegments)) return joinCatalogCategoryPath(segments);

  const nextSegments = [...segments];
  nextSegments[targetSegments.length - 1] = nextName;
  return joinCatalogCategoryPath(nextSegments);
};

const transformPathForDelete = (
  value: string,
  targetSegments: string[]
): string => {
  const segments = splitCatalogCategoryPath(value);
  if (!isPathPrefix(segments, targetSegments)) return joinCatalogCategoryPath(segments);

  return joinCatalogCategoryPath(
    segments.filter((_, index) => index !== targetSegments.length - 1)
  );
};

const rebuildProductCollections = (
  category: string,
  collections: ProductCategoryCollection[]
): ProductCategoryCollection[] => {
  const segments = splitCatalogCategoryPath(category);
  const imageByPath = new Map(
    collections.map(collection => [
      normalizedPath(collection.path),
      collection.image.trim(),
    ])
  );

  return segments.slice(1).map((name, index) => {
    const path = joinCatalogCategoryPath(segments.slice(0, index + 2));
    return {
      path,
      name,
      image: imageByPath.get(normalizedPath(path)) ?? '',
    };
  });
};

const renameProductCategoryPath = (
  product: PublicProduct,
  targetSegments: string[],
  nextName: string,
  nowIso: string
): PublicProduct => {
  const nextCategory = transformPathForRename(
    product.category,
    targetSegments,
    nextName
  );
  const transformedCollections = (product.categoryCollections ?? []).map(
    collection => {
      const path = transformPathForRename(
        collection.path,
        targetSegments,
        nextName
      );
      const segments = splitCatalogCategoryPath(path);
      return {
        ...collection,
        path,
        name: segments.at(-1) ?? collection.name,
      };
    }
  );

  if (nextCategory === product.category) return product;

  return {
    ...product,
    category: nextCategory,
    categoryCollections: rebuildProductCollections(
      nextCategory,
      transformedCollections
    ),
    updatedAt: nowIso,
  };
};

const deleteProductCategoryPath = (
  product: PublicProduct,
  targetSegments: string[],
  nowIso: string
): PublicProduct => {
  const nextCategory = transformPathForDelete(product.category, targetSegments);
  const transformedCollections = (product.categoryCollections ?? [])
    .map(collection => {
      const path = transformPathForDelete(collection.path, targetSegments);
      const segments = splitCatalogCategoryPath(path);
      return {
        ...collection,
        path,
        name: segments.at(-1) ?? collection.name,
      };
    })
    .filter(collection => splitCatalogCategoryPath(collection.path).length > 1);

  if (nextCategory === product.category) return product;

  return {
    ...product,
    category: nextCategory,
    categoryCollections: rebuildProductCollections(
      nextCategory,
      transformedCollections
    ),
    updatedAt: nowIso,
  };
};

export const renameCatalogCategoryTree = (
  products: PublicProduct[],
  storedPaths: ProductCategoryCollection[],
  targetPath: string,
  nextName: string,
  nowIso: string = new Date().toISOString()
): {
  products: PublicProduct[];
  paths: ProductCategoryCollection[];
  nextTargetPath: string;
} => {
  const targetSegments = splitCatalogCategoryPath(targetPath);
  const cleanNextName = nextName.trim().slice(0, 40);

  if (targetSegments.length <= 1) {
    throw new Error('A categoria principal é editada nas palavras-chave da loja.');
  }
  if (!cleanNextName || /[>/]/.test(cleanNextName)) {
    throw new Error('Informe um nome válido, sem “>” ou “/”.');
  }

  const currentPaths = mergeCatalogCategoryPaths(storedPaths, products);
  const targetKey = normalizedPath(targetPath);
  if (!currentPaths.some(collection => normalizedPath(collection.path) === targetKey)) {
    throw new Error('A pasta selecionada não foi encontrada.');
  }

  const nextTargetSegments = [...targetSegments];
  nextTargetSegments[targetSegments.length - 1] = cleanNextName;
  const nextTargetPath = joinCatalogCategoryPath(nextTargetSegments);
  const conflictKey = normalizedPath(nextTargetPath);

  if (
    conflictKey !== targetKey &&
    currentPaths.some(collection => normalizedPath(collection.path) === conflictKey)
  ) {
    throw new Error('Já existe uma pasta com esse nome neste nível.');
  }

  const nextProducts = products.map(product =>
    renameProductCategoryPath(product, targetSegments, cleanNextName, nowIso)
  );
  const renamedPaths = currentPaths.map(collection => {
    const path = transformPathForRename(
      collection.path,
      targetSegments,
      cleanNextName
    );
    const segments = splitCatalogCategoryPath(path);
    return {
      ...collection,
      path,
      name: segments.at(-1) ?? collection.name,
    };
  });

  return {
    products: nextProducts,
    paths: mergeCatalogCategoryPaths(uniqueCollections(renamedPaths), nextProducts),
    nextTargetPath,
  };
};

export const deleteCatalogCategoryTreePath = (
  products: PublicProduct[],
  storedPaths: ProductCategoryCollection[],
  targetPath: string,
  nowIso: string = new Date().toISOString()
): {
  products: PublicProduct[];
  paths: ProductCategoryCollection[];
  parentPath: string;
} => {
  const targetSegments = splitCatalogCategoryPath(targetPath);
  if (targetSegments.length <= 1) {
    throw new Error('A categoria principal é editada nas palavras-chave da loja.');
  }

  const currentPaths = mergeCatalogCategoryPaths(storedPaths, products);
  const targetKey = normalizedPath(targetPath);
  if (!currentPaths.some(collection => normalizedPath(collection.path) === targetKey)) {
    throw new Error('A pasta selecionada não foi encontrada.');
  }

  const nextProducts = products.map(product =>
    deleteProductCategoryPath(product, targetSegments, nowIso)
  );
  const transformedPaths = currentPaths.flatMap(collection => {
    const path = transformPathForDelete(collection.path, targetSegments);
    const segments = splitCatalogCategoryPath(path);
    if (segments.length <= 1) return [];
    return [{
      ...collection,
      path,
      name: segments.at(-1) ?? collection.name,
    }];
  });

  return {
    products: nextProducts,
    paths: mergeCatalogCategoryPaths(
      uniqueCollections(transformedPaths),
      nextProducts
    ),
    parentPath: joinCatalogCategoryPath(targetSegments.slice(0, -1)),
  };
};

/**
 * Compute only the canonical product changes required by a category operation.
 * Existing commercial and migration fields remain untouched by the writer.
 * The plan is pure so it can be verified before any Firestore writes.
 */
export const planCanonicalCategoryProductUpdates = (
  previous: PublicProduct[],
  next: PublicProduct[]
): Array<{
  id: string;
  category: string;
  categoryCollections: ProductCategoryCollection[];
}> => {
  const originalById = new Map(previous.map(product => [product.id, product]));
  if (originalById.size !== previous.length || next.length !== previous.length) {
    throw new Error('A lista de produtos mudou durante a edição da categoria.');
  }
  const seen = new Set<string>();
  const updates = next.flatMap(product => {
    const original = originalById.get(product.id);
    if (!original || seen.has(product.id)) {
      throw new Error('Produto duplicado ou ausente durante a edição da categoria.');
    }
    seen.add(product.id);
    if (
      original.category === product.category &&
      JSON.stringify(original.categoryCollections ?? []) ===
        JSON.stringify(product.categoryCollections ?? [])
    ) return [];
    return [{
      id: product.id,
      category: product.category,
      categoryCollections: product.categoryCollections ?? [],
    }];
  });
  return updates;
};

/**
 * Apply a prevalidated category plan to the canonical catalog only.
 * Recheck the cutover and each source category in one transaction; a concurrent
 * edit fails closed instead of silently overwriting newer product categories.
 * The bounded operation deliberately does not fall back to tenant.publicProducts.
 */
export const persistCanonicalCategoryProductUpdates = async (
  user: Pick<User, 'uid'>,
  canonicalStoreId: string,
  previous: PublicProduct[],
  next: PublicProduct[]
): Promise<number> => {
  const updates = planCanonicalCategoryProductUpdates(previous, next);
  if (updates.length > 100) {
    throw new Error('A categoria contém produtos demais para uma alteração atômica.');
  }
  const storeId = canonicalStoreId.trim();
  if (!storeId || storeId === user.uid) {
    throw new Error('Loja canônica inválida.');
  }
  const originalById = new Map(previous.map(product => [product.id, product]));
  const storeReference = doc(db, 'stores', storeId);
  const references = updates.map(update =>
    doc(db, 'stores', storeId, 'products', update.id)
  );
  await runTransaction(db, async transaction => {
    const storeSnapshot = await transaction.get(storeReference);
    const snapshots = [];
    for (const reference of references) {
      snapshots.push(await transaction.get(reference));
    }
    if (
      !storeSnapshot.exists() ||
      storeSnapshot.data().ownerId !== user.uid ||
      storeSnapshot.data().migrationStatus !== 'canonical'
    ) {
      throw new Error('A loja não está habilitada para edição canônica.');
    }
    updates.forEach((update, index) => {
      const snapshot = snapshots[index];
      const original = originalById.get(update.id);
      if (
        !snapshot?.exists() ||
        !original ||
        snapshot.data().category !== original.category ||
        snapshot.data().publicationStatus === 'archived'
      ) {
        throw new Error('O produto foi alterado durante a edição da categoria.');
      }
      transaction.update(references[index], {
        category: update.category,
        categoryCollections: update.categoryCollections,
        updatedAt: serverTimestamp(),
        updatedByUserId: user.uid,
        updatedByRole: 'owner',
      });
    });
  });
  return updates.length;
};

export const reconcileCatalogCategoryPaths = async (
  user: Pick<User, 'uid'>
): Promise<ProductCategoryCollection[]> => {
  const tenantReference = doc(db, 'tenants', user.uid);

  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(tenantReference);
    if (!snapshot.exists()) return [];

    const products = parsePublicProducts(snapshot.data().publicProducts);
    const storedPaths = parseCatalogCategoryPaths(
      snapshot.data().catalogCategoryPaths
    );
    const nextPaths = mergeCatalogCategoryPaths(storedPaths, products);

    if (collectionsSignature(storedPaths) !== collectionsSignature(nextPaths)) {
      transaction.set(
        tenantReference,
        {
          catalogCategoryPaths: nextPaths,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    return nextPaths;
  });
};

export const renameCatalogCategoryPath = async (
  user: Pick<User, 'uid'>,
  targetPath: string,
  nextName: string
): Promise<ReturnType<typeof renameCatalogCategoryTree>> => {
  const tenantReference = doc(db, 'tenants', user.uid);

  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(tenantReference);
    if (!snapshot.exists()) {
      throw new Error('A loja não foi encontrada para editar esta pasta.');
    }
    const canonicalStoreId = cleanString(snapshot.data().canonicalStoreId);
    if (canonicalStoreId) {
      const canonicalSnapshot = await transaction.get(doc(db, 'stores', canonicalStoreId));
      if (!canonicalSnapshot.exists() || canonicalSnapshot.data().migrationStatus === 'canonical') {
        throw new Error('A alteração da categoria foi bloqueada: a loja canônica está indisponível ou já concluiu a migração.');
      }
    }

    const result = renameCatalogCategoryTree(
      parsePublicProducts(snapshot.data().publicProducts),
      parseCatalogCategoryPaths(snapshot.data().catalogCategoryPaths),
      targetPath,
      nextName
    );

    transaction.set(
      tenantReference,
      {
        publicProducts: result.products,
        catalogCategoryPaths: result.paths,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return result;
  });
};

export const deleteCatalogCategoryPath = async (
  user: Pick<User, 'uid'>,
  targetPath: string
): Promise<ReturnType<typeof deleteCatalogCategoryTreePath>> => {
  const tenantReference = doc(db, 'tenants', user.uid);

  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(tenantReference);
    if (!snapshot.exists()) {
      throw new Error('A loja não foi encontrada para excluir esta pasta.');
    }
    const canonicalStoreId = cleanString(snapshot.data().canonicalStoreId);
    if (canonicalStoreId) {
      const canonicalSnapshot = await transaction.get(doc(db, 'stores', canonicalStoreId));
      if (!canonicalSnapshot.exists() || canonicalSnapshot.data().migrationStatus === 'canonical') {
        throw new Error('A alteração da categoria foi bloqueada: a loja canônica está indisponível ou já concluiu a migração.');
      }
    }

    const result = deleteCatalogCategoryTreePath(
      parsePublicProducts(snapshot.data().publicProducts),
      parseCatalogCategoryPaths(snapshot.data().catalogCategoryPaths),
      targetPath
    );

    transaction.set(
      tenantReference,
      {
        publicProducts: result.products,
        catalogCategoryPaths: result.paths,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return result;
  });
};
