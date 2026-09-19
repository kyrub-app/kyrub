import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('production app mounts native Gerencial integrations bridge', () => {
  const main = readFileSync('src/main.tsx', 'utf8');
  assert.match(main, /GerencialIntegrationsNativeBridge/);
  assert.match(main, /<GerencialIntegrationsNativeBridge\s*\/>/);
});

test('bridge replaces only the legacy integrations submodule', () => {
  const bridge = readFileSync(
    'src/components/GerencialIntegrationsNativeBridge.tsx',
    'utf8'
  );
  assert.match(bridge, /erp-gerencial-tab/);
  assert.match(bridge, /CONFIGURAÇÃO DE CANAIS EXTERNOS/);
  assert.match(bridge, /kyrub-native-integrations-runtime-host/);
  assert.match(bridge, /GerencialIntegrationsRuntime/);
  assert.match(bridge, /candidate\.style\.display = 'none'/);
  assert.match(bridge, /legacyGrid\.style\.display = previousDisplay/);
  assert.doesNotMatch(bridge, /innerHTML\s*=/);
});
