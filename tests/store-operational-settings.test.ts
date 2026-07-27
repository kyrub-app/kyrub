import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  STORE_INTEGRATION_IDS,
  STORE_WEEKDAYS,
  createEmptyStoreOperationalSettings,
  getStoreOperationalSettingsCacheKey,
  loadCachedStoreOperationalSettings,
  parseStoreOperationalSettings,
  saveCachedStoreOperationalSettings,
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
  test('starts without fictitious commercial hours or connected channels', () => {
    const settings = createEmptyStoreOperationalSettings();

    for (const day of STORE_WEEKDAYS) {
      assert.deepEqual(settings.openingHours[day], {
        enabled: false,
        opensAt: '',
        closesAt: '',
      });
    }

    for (const integrationId of STORE_INTEGRATION_IDS) {
      assert.deepEqual(settings.integrations[integrationId], {
        status: 'not-configured',
        environment: 'sandbox',
      });
    }
  });

  test('parses only valid hours and supported integration metadata', () => {
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
    assert.deepEqual(parsed.integrations.ifood, {
      status: 'planned',
      environment: 'production',
    });
    assert.deepEqual(parsed.integrations.sefaz, {
      status: 'not-configured',
      environment: 'sandbox',
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

  test('keeps settings available in the device cache', () => {
    const storage = new MemoryStorage();
    const settings = createEmptyStoreOperationalSettings();
    settings.openingHours.saturday = {
      enabled: true,
      opensAt: '10:00',
      closesAt: '16:00',
    };
    settings.integrations['open-delivery'] = {
      status: 'planned',
      environment: 'sandbox',
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
