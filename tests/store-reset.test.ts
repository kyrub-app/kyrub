import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Store } from '../src/types';
import {
  buildRestartedStore,
  clearLocalStoreSetup,
  hasMeaningfulStoreSetup,
  STORE_RESET_CONFIRMATION_TEXT,
  type StoreResetResult,
} from '../src/utils/storeReset';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const configuredStore = (): Store => ({
  id: 'owner-a',
  name: 'Loja de Teste',
  slug: 'loja-de-teste',
  description: 'Configuração criada durante o onboarding.',
  logo: '/logo.png',
  banner: '/banner.png',
  primaryColor: '#f97316',
  plan: 'business',
  ownerEmail: 'old@example.com',
  address: 'Rua A, 10',
  contact: '(11) 99999-9999',
  keywords: ['pizza', 'entrega'],
  offerImages: ['/offer.png'],
  status: 'open',
  lat: -23.5,
  lng: -46.6,
});

describe('safe store restart', () => {
  test('requires an explicit destructive confirmation word', () => {
    assert.equal(STORE_RESET_CONFIRMATION_TEXT, 'EXCLUIR');
  });

  test('returns the primary store to an empty onboarding state', () => {
    const restarted = buildRestartedStore(
      { uid: 'owner-a', email: 'current@example.com' },
      configuredStore()
    );

    assert.deepEqual(restarted, {
      id: 'owner-a',
      name: '',
      slug: '',
      description: '',
      logo: '',
      banner: '',
      primaryColor: '',
      plan: 'business',
      ownerEmail: 'current@example.com',
      address: '',
      contact: '',
      keywords: [],
      offerImages: [],
      status: 'closed',
    });
    assert.equal(hasMeaningfulStoreSetup(restarted), false);
  });

  test('does not allow resetting another user store', () => {
    assert.throws(
      () =>
        buildRestartedStore(
          { uid: 'owner-b', email: 'b@example.com' },
          configuredStore()
        ),
      /não pertence/
    );
  });

  test('removes only the restarted store catalog and local tenant configuration', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'kyrub_products',
      JSON.stringify([
        { id: 'own-product', supplierId: 'owner-a' },
        { id: 'another-product', supplierId: 'owner-b' },
        { id: 'store-product', storeId: 'owner-a' },
      ])
    );
    storage.setItem(
      'kyrub_tenants',
      JSON.stringify([
        { id: 'owner-a', name: 'Loja antiga' },
        { id: 'owner-b', name: 'Outra loja' },
      ])
    );
    storage.setItem('kyrub_atendimento_spaces', '["MESA 1"]');
    storage.setItem('kyrub_producao_spaces', '["COZINHA"]');

    clearLocalStoreSetup(storage, 'owner-a');

    assert.deepEqual(JSON.parse(storage.getItem('kyrub_products') ?? '[]'), [
      { id: 'another-product', supplierId: 'owner-b' },
    ]);
    assert.deepEqual(JSON.parse(storage.getItem('kyrub_tenants') ?? '[]'), [
      { id: 'owner-b', name: 'Outra loja' },
    ]);
    assert.equal(storage.getItem('kyrub_atendimento_spaces'), null);
    assert.equal(storage.getItem('kyrub_producao_spaces'), null);
  });

  test('declares operational history as preserved in the reset result', () => {
    const result: StoreResetResult = {
      store: buildRestartedStore(
        { uid: 'owner-a', email: 'current@example.com' },
        configuredStore()
      ),
      archivedCanonicalProducts: 3,
      pausedMarketplaceOffers: 2,
      preservedOperationalHistory: true,
      warnings: [],
    };

    assert.equal(result.preservedOperationalHistory, true);
  });
});
