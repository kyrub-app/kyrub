import type { User } from 'firebase/auth';
import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import type { ProductCategoryCollection } from '../types';
import { db } from './firebase';
import {
  joinCatalogCategoryPath,
  mergeCatalogCategoryPaths,
  normalizeCatalogCategoryValue,
  parseCatalogCategoryPaths,
  splitCatalogCategoryPath,
} from './catalogCategoryTree';
import { parsePublicProducts } from './publicProducts';

/**
 * Commercial hierarchy used for new catalog organization.
 *
 * The category root is owned by the store profile. Products can then be
 * organized into an optional Group and optional Subgroup:
 * Category > Group > Subgroup > Product.
 *
 * catalogCategoryTree intentionally still accepts deeper historical paths so
 * existing products remain readable/editable without destructive migration.
 */
export const CATALOG_HIERARCHY_TIERS = [
  'Grupo',
  'Subgrupo',
] as const;

export const MAX_CATALOG_HIERARCHY_CHILDREN = 5;
export const MAX_CATALOG_HIERARCHY_SEGMENTS =
  CATALOG_HIERARCHY_TIERS.length + 1;

const normalizedPath = (value: string): string =>
  splitCatalogCategoryPath(value)
    .map(normalizeCatalogCategoryValue)
    .join(' > ');

const pathStartsWith = (value: string[], prefix: string[]): boolean =>
  value.length >= prefix.length &&
  prefix.every(
    (segment, index) =>
      normalizeCatalogCategoryValue(value[index] ?? '') ===
      normalizeCatalogCategoryValue(segment)
  );

export const getDirectCatalogHierarchyChildren = (
  paths: ProductCategoryCollection[],
  parentPath: string
): ProductCategoryCollection[] => {
  const parentSegments = splitCatalogCategoryPath(parentPath);
  if (parentSegments.length === 0) return [];

  const byPath = new Map<string, ProductCategoryCollection>();
  for (const collection of paths) {
    const segments = splitCatalogCategoryPath(collection.path);
    if (
      segments.length !== parentSegments.length + 1 ||
      !pathStartsWith(segments, parentSegments)
    ) {
      continue;
    }

    const path = joinCatalogCategoryPath(segments);
    byPath.set(normalizedPath(path), {
      path,
      name: segments.at(-1) ?? collection.name,
      image: collection.image.trim(),
    });
  }

  return [...byPath.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'pt-BR')
  );
};

export const addCatalogHierarchyTreePath = (
  paths: ProductCategoryCollection[],
  parentPath: string,
  name: string
): ProductCategoryCollection[] => {
  const parentSegments = splitCatalogCategoryPath(parentPath);
  const cleanName = name.trim().slice(0, 40);

  if (parentSegments.length === 0) {
    throw new Error('Selecione primeiro a categoria da loja.');
  }
  if (parentSegments.length >= MAX_CATALOG_HIERARCHY_SEGMENTS) {
    throw new Error('A hierarquia comercial já chegou ao nível de subgrupo.');
  }
  if (!cleanName || /[>/]/.test(cleanName)) {
    throw new Error('Informe um nome válido, sem “>” ou “/”.');
  }

  const children = getDirectCatalogHierarchyChildren(paths, parentPath);
  const normalizedName = normalizeCatalogCategoryValue(cleanName);
  const existing = children.find(
    child => normalizeCatalogCategoryValue(child.name) === normalizedName
  );
  if (existing) return paths;
  if (children.length >= MAX_CATALOG_HIERARCHY_CHILDREN) {
    throw new Error(
      `Cada nível aceita até ${MAX_CATALOG_HIERARCHY_CHILDREN} opções dentro do mesmo grupo.`
    );
  }

  const nextPath = joinCatalogCategoryPath([...parentSegments, cleanName]);
  return [
    ...paths,
    { path: nextPath, name: cleanName, image: '' },
  ].sort((left, right) => {
    const depthDifference =
      splitCatalogCategoryPath(left.path).length -
      splitCatalogCategoryPath(right.path).length;
    return depthDifference || left.path.localeCompare(right.path, 'pt-BR');
  });
};

export const createCatalogHierarchyPath = async (
  user: Pick<User, 'uid'>,
  parentPath: string,
  name: string
): Promise<ProductCategoryCollection[]> => {
  const tenantReference = doc(db, 'tenants', user.uid);

  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(tenantReference);
    if (!snapshot.exists()) {
      throw new Error('A loja não foi encontrada para criar este nível.');
    }

    const products = parsePublicProducts(snapshot.data().publicProducts);
    const currentPaths = mergeCatalogCategoryPaths(
      parseCatalogCategoryPaths(snapshot.data().catalogCategoryPaths),
      products
    );
    const nextPaths = addCatalogHierarchyTreePath(
      currentPaths,
      parentPath,
      name
    );

    transaction.set(
      tenantReference,
      {
        catalogCategoryPaths: nextPaths,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return nextPaths;
  });
};
