import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ProductCategoryCollection } from '../src/types';
import {
  addCatalogHierarchyTreePath,
  CATALOG_HIERARCHY_TIERS,
  getDirectCatalogHierarchyChildren,
  MAX_CATALOG_HIERARCHY_CHILDREN,
  MAX_CATALOG_HIERARCHY_SEGMENTS,
} from '../src/utils/catalogHierarchy';

const add = (
  paths: ProductCategoryCollection[],
  parent: string,
  name: string
): ProductCategoryCollection[] =>
  addCatalogHierarchyTreePath(paths, parent, name);

describe('semantic catalog hierarchy', () => {
  test('uses category, subcategory, group, subgroup and folder', () => {
    assert.deepEqual(CATALOG_HIERARCHY_TIERS, [
      'Subcategoria',
      'Grupo',
      'Subgrupo',
      'Pasta',
    ]);
    assert.equal(MAX_CATALOG_HIERARCHY_SEGMENTS, 5);
  });

  test('creates reusable direct children below their selected parent', () => {
    let paths: ProductCategoryCollection[] = [];
    paths = add(paths, 'Alimentação', 'Restaurante');
    paths = add(paths, 'Alimentação', 'Pizzaria');
    paths = add(paths, 'Alimentação > Restaurante', 'Rodízio');
    paths = add(
      paths,
      'Alimentação > Restaurante > Rodízio',
      'Repetição'
    );

    assert.deepEqual(
      getDirectCatalogHierarchyChildren(paths, 'Alimentação').map(
        child => child.name
      ),
      ['Pizzaria', 'Restaurante']
    );
    assert.deepEqual(
      getDirectCatalogHierarchyChildren(
        paths,
        'Alimentação > Restaurante'
      ).map(child => child.name),
      ['Rodízio']
    );
  });

  test('does not duplicate an existing sibling', () => {
    const paths = add([], 'Alimentação', 'Restaurante');
    const duplicate = add(paths, 'Alimentação', ' restaurante ');
    assert.deepEqual(duplicate, paths);
  });

  test('limits each parent to five child options', () => {
    let paths: ProductCategoryCollection[] = [];
    for (let index = 1; index <= MAX_CATALOG_HIERARCHY_CHILDREN; index += 1) {
      paths = add(paths, 'Alimentação', `Subcategoria ${index}`);
    }

    assert.throws(
      () => add(paths, 'Alimentação', 'Subcategoria 6'),
      /até 5 opções/
    );
  });

  test('stops creation after the folder tier', () => {
    assert.throws(
      () =>
        add(
          [],
          'Alimentação > Restaurante > Rodízio > Repetição > Mesa 1',
          'Nível extra'
        ),
      /nível de pasta/
    );
  });

  test('rejects invalid folder names', () => {
    assert.throws(
      () => add([], 'Alimentação', 'Restaurante > Rodízio'),
      /sem “>” ou “\/”/
    );
  });
});
