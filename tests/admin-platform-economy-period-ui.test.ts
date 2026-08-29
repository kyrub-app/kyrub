import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('admin platform economy period controls', () => {
  test('workspace exposes canonical presets and reloads through the authenticated client', () => {
    const workspace = readFileSync(
      'src/components/admin/AdminPlatformEconomyWorkspace.tsx',
      'utf8'
    );

    assert.match(workspace, /ADMIN_PLATFORM_ECONOMY_PERIODS/);
    assert.match(workspace, /useState<AdminPlatformEconomyPeriod>\('all'\)/);
    assert.match(workspace, /loadAdminPlatformEconomy\(user, period\)/);
    assert.match(workspace, /setPeriod\(candidate\)/);
    assert.match(workspace, /aria-pressed=\{selected\}/);
    assert.match(workspace, /7 dias/);
    assert.match(workspace, /30 dias/);
    assert.match(workspace, /90 dias/);
    assert.match(workspace, /Todo período/);
  });

  test('workspace labels totals and AI cost with the selected period', () => {
    const workspace = readFileSync(
      'src/components/admin/AdminPlatformEconomyWorkspace.tsx',
      'utf8'
    );

    assert.match(workspace, /Destinações econômicas · \{periodLabel\(period\)\}/);
    assert.match(workspace, /Custo de IA · \{periodLabel\(period\)\}/);
    assert.match(workspace, /Totais e IA: \{periodLabel\(period\)\}/);
    assert.match(workspace, /dentro do período selecionado/);
  });
});
