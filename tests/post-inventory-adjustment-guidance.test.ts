import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const portal = readFileSync(
  'src/components/store/StoreConnectionsPortalBridge.tsx',
  'utf8'
);

test('post-adjustment guidance appears only after an authoritative inventory refresh version exists', () => {
  assert.match(portal, /inventoryRefreshVersion > 0/);
  assert.match(portal, /id="kyrub-post-inventory-adjustment-guidance"/);
  assert.match(portal, /Ajuste confirmado · visões reconsultadas/);
});

test('guidance explicitly separates refreshed views from resolved ATP', () => {
  assert.match(portal, /Isso não significa que um bloqueio ATP foi resolvido/);
  assert.match(portal, /se o pedido 99Food continuar listado, ele permanece bloqueado/);
  assert.match(portal, /Tentar reservar novamente/);
});

test('guidance is informational and cannot arm or execute reservation retry', () => {
  const guidance = portal.match(
    /<div\s+id="kyrub-post-inventory-adjustment-guidance"[\s\S]*?<\/div>/
  )?.[0] ?? '';

  assert.match(guidance, /role="status"/);
  assert.doesNotMatch(guidance, /<button|onClick|retry|fetch\(/i);
});
