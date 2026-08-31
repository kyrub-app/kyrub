import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('merchant Mercado Livre workspace keeps platform credentials out of the store UI', async () => {
  const workspace = await read('src/components/store/StoreConnectionsWorkspace.tsx');
  const client = await read('src/utils/storeConnections.ts');

  assert.match(workspace, /Conectar Mercado Livre/);
  assert.match(workspace, /Client Secret da aplicação/);
  assert.match(workspace, /Access Token do vendedor/);
  assert.doesNotMatch(workspace, /type="(?:text|password)"[^>]*(?:client.?secret|access.?token|refresh.?token)/i);
  assert.match(client, /\/api\/store-connections\/mercado-livre\/\$\{encoded\(storeId\)\}\/authorize/);
  assert.doesNotMatch(client, /auth\.mercadolivre|mercadolibre\.com\/authorization/);
});

test('catalog import remains preview-first and human-confirmed', async () => {
  const workspace = await read('src/components/store/StoreConnectionsWorkspace.tsx');
  const client = await read('src/utils/storeConnections.ts');

  assert.match(workspace, /Ver produtos do Mercado Livre/);
  assert.match(workspace, /Preview somente leitura/);
  assert.match(workspace, /Importar .* como rascunho/);
  assert.match(workspace, /Nada foi publicado automaticamente/);
  assert.match(client, /catalog-preview/);
  assert.match(client, /catalog-import/);
  assert.match(client, /JSON\.stringify\(\{ itemIds \}\)/);
});

test('OAuth callback cleanup preserves unrelated query state', async () => {
  const workspace = await read('src/components/store/StoreConnectionsWorkspace.tsx');

  assert.match(workspace, /params\.delete\('integration'\)/);
  assert.match(workspace, /params\.delete\('status'\)/);
  assert.match(workspace, /params\.delete\('code'\)/);
  assert.doesNotMatch(workspace, /params\.delete\('storeId'\)/);
  assert.doesNotMatch(workspace, /params\.delete\('tab'\)/);
});

test('retailer management surface mounts the store connection workspace', async () => {
  const retailer = await read('src/components/RetailerPanel.tsx');

  assert.match(retailer, /StoreConnectionsWorkspace/);
  assert.match(retailer, /authenticatedUser|user=/);
  assert.match(retailer, /storeId=\{activeRetailerId\}/);
});
