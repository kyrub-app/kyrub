import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  STORE_INTEGRATION_IDS,
  STORE_WEEKDAYS,
  createEmptyStoreFiscalIssuerProfile,
  createEmptyStoreIntegrationPlan,
  createEmptyStoreOperationalSettings,
  getStoreOperationalSettingsCacheKey,
  loadCachedStoreOperationalSettings,
  parseStoreOperationalSettings,
  saveCachedStoreOperationalSettings,
  validateStoreIntegrationSetup,
  validateStoreOpeningHours,
} from '../src/utils/storeOperationalSettings';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('store operational settings', () => {
  test('starts without fictitious commercial hours, connected channels or fiscal identity', () => {
    const settings = createEmptyStoreOperationalSettings();

    for (const day of STORE_WEEKDAYS) {
      assert.deepEqual(settings.openingHours[day], {
        enabled: false,
        opensAt: '',
        closesAt: '',
      });
    }

    for (const integrationId of STORE_INTEGRATION_IDS) {
      assert.deepEqual(
        settings.integrations[integrationId],
        createEmptyStoreIntegrationPlan()
      );
    }

    assert.deepEqual(
      settings.fiscalIssuerProfile,
      createEmptyStoreFiscalIssuerProfile()
    );
  });

  test('migrates old planning metadata into an editable draft', () => {
    const parsed = parseStoreOperationalSettings({
      openingHours: {
        monday: { enabled: true, opensAt: '08:30', closesAt: '22:00' },
        tuesday: { enabled: true, opensAt: 'invalid', closesAt: '18:00' },
      },
      integrations: {
        ifood: { status: 'planned', environment: 'production' },
        sefaz: { status: 'connected', environment: 'unknown' },
      },
    });

    assert.deepEqual(parsed.openingHours.monday, {
      enabled: true,
      opensAt: '08:30',
      closesAt: '22:00',
    });
    assert.deepEqual(parsed.openingHours.tuesday, {
      enabled: false,
      opensAt: '',
      closesAt: '18:00',
    });
    assert.equal(parsed.integrations.ifood.status, 'draft');
    assert.equal(parsed.integrations.ifood.environment, 'production');
    assert.equal(parsed.integrations.ifood.accountLabel, '');
    assert.deepEqual(
      parsed.integrations.sefaz,
      createEmptyStoreIntegrationPlan()
    );
  });

  test('migrates legacy SEFAZ public identity into the canonical fiscal issuer profile', () => {
    const parsed = parseStoreOperationalSettings({
      integrations: {
        sefaz: {
          status: 'draft',
          environment: 'production',
          accountLabel: '  Restaurante Centro Ltda.  ',
          externalStoreId: ' 12.345.678/0001-90 ',
        },
      },
    });

    assert.deepEqual(parsed.fiscalIssuerProfile, {
      legalName: 'Restaurante Centro Ltda.',
      taxIdentifier: '12.345.678/0001-90',
      environment: 'production',
    });
  });

  test('canonical fiscal issuer profile wins and keeps the legacy SEFAZ card synchronized', () => {
    const parsed = parseStoreOperationalSettings({
      fiscalIssuerProfile: {
        legalName: ' Unidade Fiscal Canônica Ltda. ',
        taxIdentifier: ' 98.765.432/0001-10 ',
        environment: 'production',
        certificate: 'must-not-be-persisted',
        password: 'must-not-be-persisted',
      },
      integrations: {
        sefaz: {
          status: 'draft',
          environment: 'sandbox',
          accountLabel: 'Nome legado',
          externalStoreId: '00.000.000/0000-00',
        },
      },
    });

    assert.deepEqual(parsed.fiscalIssuerProfile, {
      legalName: 'Unidade Fiscal Canônica Ltda.',
      taxIdentifier: '98.765.432/0001-10',
      environment: 'production',
    });
    assert.equal(parsed.integrations.sefaz.accountLabel, 'Unidade Fiscal Canônica Ltda.');
    assert.equal(parsed.integrations.sefaz.externalStoreId, '98.765.432/0001-10');
    assert.equal(parsed.integrations.sefaz.environment, 'production');
    assert.deepEqual(Object.keys(parsed.fiscalIssuerProfile).sort(), [
      'environment',
      'legalName',
      'taxIdentifier',
    ]);
  });

  test('normalizes non-secret integration onboarding fields', () => {
    const parsed = parseStoreOperationalSettings({
      integrations: {
        '99food': {
          status: 'sandbox-ready',
          environment: 'sandbox',
          accountLabel: '  Loja Centro  ',
          externalStoreId: ' merchant-123 ',
          routingTarget: ' COZINHA ',
          receiveOrders: true,
          syncCatalog: true,
          syncInventory: false,
          lastTestAt: '2026-07-27T12:00:00.000Z',
        },
      },
    });

    assert.deepEqual(parsed.integrations['99food'], {
      status: 'sandbox-ready',
      environment: 'sandbox',
      accountLabel: 'Loja Centro',
      externalStoreId: 'merchant-123',
      routingTarget: 'COZINHA',
      receiveOrders: true,
      syncCatalog: true,
      syncInventory: false,
      lastTestAt: '2026-07-27T12:00:00.000Z',
    });
  });

  test('requires complete active schedules and rejects identical times', () => {
    const settings = createEmptyStoreOperationalSettings();
    settings.openingHours.monday = {
      enabled: true,
      opensAt: '09:00',
      closesAt: '',
    };

    assert.throws(
      () => validateStoreOpeningHours(settings.openingHours),
      /Preencha os horários/
    );

    settings.openingHours.monday.closesAt = '09:00';
    assert.throws(
      () => validateStoreOpeningHours(settings.openingHours),
      /mesmo horário/
    );

    settings.openingHours.monday.closesAt = '18:00';
    assert.doesNotThrow(() => validateStoreOpeningHours(settings.openingHours));
  });

  test('validates account identity and operational routing before tests', () => {
    const plan = {
      ...createEmptyStoreIntegrationPlan(),
      status: 'draft' as const,
      receiveOrders: true,
    };

    assert.throws(
      () => validateStoreIntegrationSetup('ifood', plan, { forOrderTest: true }),
      /nome da conta/
    );

    plan.accountLabel = 'Loja Centro';
    assert.throws(
      () => validateStoreIntegrationSetup('ifood', plan, { forOrderTest: true }),
      /identificador da loja/
    );

    plan.externalStoreId = 'merchant-123';
    assert.throws(
      () => validateStoreIntegrationSetup('ifood', plan, { forOrderTest: true }),
      /fila, setor ou equipe/
    );

    plan.routingTarget = 'COZINHA';
    assert.doesNotThrow(() =>
      validateStoreIntegrationSetup('ifood', plan, { forOrderTest: true })
    );
    assert.throws(
      () => validateStoreIntegrationSetup('sefaz', plan, { forOrderTest: true }),
      /integração fiscal/
    );
  });

  test('keeps settings available in the device cache', () => {
    const storage = new MemoryStorage();
    const settings = createEmptyStoreOperationalSettings();
    settings.openingHours.saturday = {
      enabled: true,
      opensAt: '10:00',
      closesAt: '16:00',
    };
    settings.integrations['open-delivery'] = {
      ...createEmptyStoreIntegrationPlan(),
      status: 'awaiting-authorization',
      accountLabel: 'Unidade Centro',
      externalStoreId: 'merchant-123',
      routingTarget: 'EXPEDIÇÃO',
      receiveOrders: true,
    };

    saveCachedStoreOperationalSettings(storage, 'user-a', settings);

    assert.match(
      getStoreOperationalSettingsCacheKey('user-a'),
      /kyrub_store_operational_settings_user-a/
    );
    assert.deepEqual(
      loadCachedStoreOperationalSettings(storage, 'user-a'),
      settings
    );
  });
});