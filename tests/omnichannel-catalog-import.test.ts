import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCatalogImportPreview,
  canImportCatalog,
  confirmCatalogImportPreview,
} from '../shared/omnichannelCatalogImport';

test('catalog discovery produces preview only, never implicit import', () => {
  const preview = buildCatalogImportPreview({
    previewId: 'preview-1',
    storeId: 'store-1',
    connectionId: 'conn-1',
    source: 'mercado_livre',
    discoveredAt: '2026-08-23T18:00:00.000Z',
    items: [{ externalId: 'ml-1', title: 'Produto A', category: 'Categoria', price: 10, imageUrls: [], stock: 3, rawFingerprint: 'fp-1' }],
    conflicts: [],
  });
  assert.equal(preview.requiresHumanConfirmation, true);
  assert.equal(preview.importAllowed, true);
  assert.equal(canImportCatalog(preview), false);
});

test('human confirmation must match preview store and connection', () => {
  const preview = buildCatalogImportPreview({
    previewId: 'preview-2', storeId: 'store-2', connectionId: 'conn-2', source: 'shopee', discoveredAt: '2026-08-23T18:00:00.000Z',
    items: [{ externalId: 'sp-1', title: 'Produto B', imageUrls: [], rawFingerprint: 'fp-2' }], conflicts: [],
  });
  const confirmation = confirmCatalogImportPreview(preview, { confirmedByUserId: 'user-1', confirmedAt: '2026-08-23T18:05:00.000Z' });
  assert.equal(canImportCatalog(preview, confirmation), true);
  assert.equal(canImportCatalog({ ...preview, connectionId: 'other' }, confirmation), false);
});

test('duplicate external ids fail closed during discovery normalization', () => {
  assert.throws(() => buildCatalogImportPreview({
    previewId: 'preview-3', storeId: 'store-3', connectionId: 'conn-3', source: 'erp', discoveredAt: '2026-08-23T18:00:00.000Z',
    items: [
      { externalId: 'x', title: 'A', imageUrls: [], rawFingerprint: 'a' },
      { externalId: 'x', title: 'B', imageUrls: [], rawFingerprint: 'b' },
    ], conflicts: [],
  }), /CATALOG_DUPLICATE_EXTERNAL_ID/);
});
