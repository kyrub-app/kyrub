import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveKyrubiaDeterministicStoreOperation } from '../src/ai/deterministicStoreOperation';

test('store operation parser prepares explicit status changes with anti-stale state', () => {
  const resolution = resolveKyrubiaDeterministicStoreOperation('Abra minha loja', 'closed');
  assert.ok(resolution);
  assert.equal(resolution.proposal.type, 'update_store_operation');
  assert.equal(resolution.proposal.expectedCurrentStatus, 'closed');
  assert.equal(resolution.proposal.status, 'open');
  assert.equal(resolution.proposal.requiresConfirmation, true);
});

test('store operation parser normalizes one weekday schedule deterministically', () => {
  const resolution = resolveKyrubiaDeterministicStoreOperation(
    'Na segunda abrimos das 18h às 23h',
    'open'
  );
  assert.ok(resolution);
  assert.deepEqual(resolution.proposal.openingHours, [{
    day: 'monday',
    enabled: true,
    opensAt: '18:00',
    closesAt: '23:00',
  }]);
});

test('integration configuration is not interpreted as a store operation', () => {
  assert.equal(
    resolveKyrubiaDeterministicStoreOperation(
      'Configure o externalStoreId do 99Food e ative o recebimento de pedidos',
      'open'
    ),
    null
  );
});

test('store operation bridge states explicitly that integrations are outside the action', () => {
  const bridge = readFileSync('src/components/KyrubAiStoreOperationActionBridge.tsx', 'utf8');
  assert.match(bridge, /Configurações de integrações externas/);
  assert.match(bridge, /executeKyrubAction/);
  assert.match(bridge, /invalidateKyrubErpContext/);
});
