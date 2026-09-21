import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const crmBridgeSource = readFileSync(
  'src/components/store/StoreCrmRelationshipBridge.tsx',
  'utf8'
);
const mobileMenuSource = readFileSync(
  'src/components/MobileErpMenu.tsx',
  'utf8'
);

test('store CRM is mounted in Gerencial instead of the PDV client workspace', () => {
  assert.match(crmBridgeSource, /erp-gerencial-tab/);
  assert.doesNotMatch(crmBridgeSource, /erp-clientes-tab/);
  assert.match(crmBridgeSource, /StoreCrmRelationshipPanel/);
  assert.match(crmBridgeSource, /detail\?\.module === 'crm'/);
});

test('mobile Gerencial module selections enter the Gerencial tab before opening a module', () => {
  assert.match(
    mobileMenuSource,
    /if \(isManagementModule\(itemId\)\) \{\s*actions\.onSelectTab\('gerencial'\);\s*selectManagement\(itemId\);/s
  );
});

test('legacy Gerencial CRM entry is promoted from placeholder to the real module', () => {
  assert.match(crmBridgeSource, /candidate\.disabled = false/);
  assert.match(crmBridgeSource, /candidate\.dataset\.kyrubCrmEntry = 'true'/);
  assert.match(crmBridgeSource, /setCrmSelected\(true\)/);
});
