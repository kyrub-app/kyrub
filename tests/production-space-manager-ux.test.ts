import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('production spaces mirror the editable service-location card pattern', () => {
  const manager = readFileSync(
    'src/components/store/ProductionSpaceManager.tsx',
    'utf8'
  );
  const modal = readFileSync(
    'src/components/modals/LegacyStoreConfigModal.tsx',
    'utf8'
  );

  assert.match(manager, /id="production-space-manager"/);
  assert.match(manager, /Espaços de produção/);
  assert.match(manager, /Salvar/);
  assert.match(manager, /Ativo/);
  assert.match(manager, /Inativo/);
  assert.match(manager, /setPendingActivation/);
  assert.match(manager, /setPendingRename/);
  assert.doesNotMatch(modal, /producaoSpaces\.map\(space/);
  assert.match(modal, /<ProductionSpaceManager/);
});

test('environment tab hides the redundant global store footer', () => {
  const modal = readFileSync(
    'src/components/modals/LegacyStoreConfigModal.tsx',
    'utf8'
  );

  assert.match(
    modal,
    /configActiveTab === 'ambiente' \? 'hidden' : 'flex'/
  );
  assert.match(modal, /data-store-config-footer="true"/);
});
