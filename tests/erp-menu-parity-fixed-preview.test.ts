import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/LegacyApp.tsx', 'utf8');
const runtime = readFileSync('src/components/MobileErpMenuRuntime.tsx', 'utf8');
const canonical = readFileSync('src/components/MobileErpMenu.tsx', 'utf8');

test('desktop uses canonical ERP catalog and shared navigation handler', () => {
  assert.match(source, /MOBILE_ERP_MENU_ITEMS\\.map\\(item =>/);
  assert.match(source, /commitMobileErpMenuSelection\\(item\\.id/);
  assert.match(source, /data-kyrub-desktop-menu-item=\\{item\\.id\\}/);
  assert.doesNotMatch(source, /\\{ id: 'gerencial', label: 'Gerencial'/);
});

test('Vite runtime exposes the canonical menu contract', () => {
  assert.match(runtime, /export \\{ MOBILE_ERP_MENU_ITEMS, commitMobileErpMenuSelection \\} from '\\.\\/MobileErpMenu'/);
  assert.match(runtime, /MOBILE_ERP_MENU_ITEMS/);
});

test('canonical catalog covers management and operational destinations', () => {
  for (const item of ['planos', 'loja', 'financeiro', 'fiscal', 'crm', 'clientes', 'caixa', 'pedidos']) {
    assert.match(canonical, new RegExp(`id: '${item}'`));
  }
});
