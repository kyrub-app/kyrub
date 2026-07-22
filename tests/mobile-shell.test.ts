import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');

test('application shell provides dynamic viewport and safe-area support', () => {
  const css = read('src/styles/app-shell.css');

  assert.match(css, /min-height:\s*100dvh/);
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /font-size:\s*16px\s*!important/);
});

test('root application and entry point load the mobile-safe shell', () => {
  const app = read('src/App.tsx');
  const main = read('src/main.tsx');

  assert.match(app, /className="kyrub-app-shell"/);
  assert.match(app, /data-kyrub-shell="application"/);
  assert.match(main, /styles\/app-shell\.css/);
});

test('mobile ERP drawer locks both document scroll containers and restores focusable navigation', () => {
  const menu = read('src/components/MobileErpMenu.tsx');

  assert.match(menu, /document\.documentElement\.style\.overflow = 'hidden'/);
  assert.match(menu, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(menu, /aria-modal="true"/);
  assert.match(menu, /tabIndex=\{-1\}/);
  assert.match(menu, /h-11 w-11/);
});

test('staff viewport uses mobile-safe dimensions and touch-sized controls', () => {
  const staff = read('src/components/StaffViewport.tsx');

  assert.match(staff, /min-h-\[100dvh\]/);
  assert.match(staff, /overflow-x-hidden/);
  assert.match(staff, /min-h-12/);
  assert.match(staff, /sm:flex-row/);
});
