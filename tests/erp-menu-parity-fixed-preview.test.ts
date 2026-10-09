import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const desktop = readFileSync('src/LegacyApp.tsx', 'utf8');
const runtime = readFileSync('src/components/MobileErpMenuRuntime.tsx', 'utf8');
const canonical = readFileSync('src/components/MobileErpMenu.tsx', 'utf8');

test('desktop renders the shared ERP menu catalog and uses canonical selection', () => {
  assert.ok(desktop.includes('MOBILE_ERP_MENU_ITEMS.map(item =>'));
  assert.ok(desktop.includes('commitMobileErpMenuSelection(item.id'));
  assert.ok(desktop.includes('data-kyrub-desktop-menu-item={item.id}'));
  assert.ok(!desktop.includes("{ id: 'gerencial', label: 'Gerencial'"));
});

test('production runtime exposes the canonical menu contract', () => {
  assert.ok(runtime.includes("export { MOBILE_ERP_MENU_ITEMS, commitMobileErpMenuSelection } from './MobileErpMenu'"));
});

test('shared catalog covers key management and operational destinations', () => {
  for (const id of ['planos', 'loja', 'financeiro', 'fiscal', 'crm', 'clientes', 'caixa', 'pedidos']) {
    assert.ok(canonical.includes(`id: '${id}'`), `Missing ERP destination: ${id}`);
  }
});
