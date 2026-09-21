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
const retailerRouterSource = readFileSync(
  'src/components/RetailerPanelRuntimeRouter.tsx',
  'utf8'
);

test('store CRM is no longer injected into the PDV client workspace', () => {
  assert.doesNotMatch(crmBridgeSource, /erp-clientes-tab/);
  assert.doesNotMatch(crmBridgeSource, /createPortal/);
  assert.match(crmBridgeSource, /StoreCrmRelationshipBridge = \(\) => null/);
});

test('CRM is an authoritative direct management module that reuses the existing panel', () => {
  assert.match(
    retailerRouterSource,
    /crm:\s*\{[\s\S]*?status:\s*'native'/
  );
  assert.match(retailerRouterSource, /LazyCrmRelationshipPanel/);
  assert.match(retailerRouterSource, /moduleId === 'crm'/);
  assert.match(
    retailerRouterSource,
    /<LazyCrmRelationshipPanel storeId=\{retailerProps\.activeRetailerId\} \/>/
  );
});

test('direct management selections do not reactivate the removed legacy Gerencial route', () => {
  assert.match(
    mobileMenuSource,
    /if \(isManagementModule\(itemId\)\) \{\s*selectManagement\(itemId\);\s*return;\s*\}/s
  );
  assert.doesNotMatch(
    mobileMenuSource,
    /if \(isManagementModule\(itemId\)\) \{\s*actions\.onSelectTab\('gerencial'\)/s
  );
});
