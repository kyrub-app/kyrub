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

describe('commercial catalog hierarchy', () => {
  test('uses category, group and subgroup for new organization', () => {
    assert.deepEqual(CATALOG_HIERARCHY_TIERS, [
      'Grupo',
      'Subgrupo',
    ]);
    assert.equal(MAX_CATALOG_HIERARCHY_SEGMENTS, 3);
  });

  test('creates reusable groups and subgroups below their selected parent', () => {
    let paths: ProductCategoryCollection[] = [];
    paths = add(paths, 'Alimentação', 'Lanches');
    paths = add(paths, 'Alimentação', 'Sobremesas');
    paths = add(paths, 'Alimentação > Lanches', 'Burgers Artesanais');

    assert.deepEqual(
      getDirectCatalogHierarchyChildren(paths, 'Alimentação').map(
        child => child.name
      ),
      ['Lanches', 'Sobremesas']
    );
    assert.deepEqual(
      getDirectCatalogHierarchyChildren(
        paths,
        'Alimentação > Lanches'
      ).map(child => child.name),
      ['Burgers Artesanais']
    );
  });

  test('does not duplicate an existing sibling', () => {
    const paths = add([], 'Alimentação', 'Lanches');
    const duplicate = add(paths, 'Alimentação', ' lanches ');
    assert.deepEqual(duplicate, paths);
  });

  test('limits each parent to five child options', () => {
    let paths: ProductCategoryCollection[] = [];
    for (let index = 1; index <= MAX_CATALOG_HIERARCHY_CHILDREN; index += 1) {
      paths = add(paths, 'Alimentação', `Grupo ${index}`);
    }

    assert.throws(
      () => add(paths, 'Alimentação', 'Grupo 6'),
      /até 5 opções/
    );
  });

  test('stops new hierarchy creation after subgroup', () => {
    assert.throws(
      () =>
        add(
          [],
          'Alimentação > Lanches > Burgers Artesanais',
          'Nível extra'
        ),
      /nível de subgrupo/
    );
  });

  test('rejects invalid group names', () => {
    assert.throws(
      () => add([], 'Alimentação', 'Lanches > Burgers'),
      /sem “>” ou “\/”/
    );
  });
});
