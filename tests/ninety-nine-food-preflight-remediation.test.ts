import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const queue = readFileSync(
  'src/components/store/StoreChannelOperationsQueue.tsx',
  'utf8'
);
const bindingHandoff = readFileSync(
  'src/utils/ninetyNineFoodBindingRemediation.ts',
  'utf8'
);
const inventoryHandoff = readFileSync(
  'src/utils/physicalInventoryRemediation.ts',
  'utf8'
);

test('current binding preflight evidence is routed without reusing stale blocked-order ids', () => {
  assert.match(
    queue,
    /openBindingRemediation\(preflight\.unresolvedExternalProductIds\)/
  );
  assert.match(queue, /Corrigir binding atual/);
  assert.match(queue, /requestNinetyNineFoodBindingRemediation\(externalProductIds\)/);
});

test('each current ATP shortage routes by its exact canonical inventory item id', () => {
  assert.match(queue, /preflight\.lines\.filter\(line => line\.shortageQuantity > 0\)/);
  assert.match(queue, /openInventoryRemediation\(line\.inventoryItemId\)/);
  assert.match(queue, /requestPhysicalInventoryFocus\(normalized\)/);
  assert.match(queue, /Abrir item/);
  assert.doesNotMatch(queue, /line\.inventoryItemId[\s\S]{0,80}(?:name|title|sku)/i);
});

test('preflight remediation helpers only hand off exact context and navigate', () => {
  const bindingHelper = queue.match(
    /const openBindingRemediation[\s\S]*?\n};\n\nconst openInventoryRemediation/
  )?.[0] ?? '';
  const inventoryHelper = queue.match(
    /const openInventoryRemediation[\s\S]*?\n};\n\nconst openRemediation/
  )?.[0] ?? '';

  assert.doesNotMatch(
    bindingHelper + inventoryHelper,
    /retryNinetyNineFoodBlockedOrderReservation|preflightNinetyNineFoodBlockedOrderReservation|fetch\(|executeKyrubAction/
  );
  assert.doesNotMatch(
    bindingHandoff + inventoryHandoff,
    /localStorage|sessionStorage|indexedDB|Firestore|fetch\(/i
  );
});

test('current-evidence remediation never changes the separate two-step retry authority', () => {
  assert.match(queue, /confirmRetryOrderId !== item\.reference/);
  assert.match(queue, /Confirmar nova tentativa/);
  assert.match(queue, /O preflight é somente leitura/);
});
