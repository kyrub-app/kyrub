import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Store } from '../src/types';
import {
  getUserStoreCacheKey,
  loadUserStoreCache,
  parseUserStoreCache,
  saveUserStoreCache,
  serializeUserStoreCache,
  type UserStoreCacheStorage,
} from '../src/utils/userStoreCache';

const store = (overrides: Partial<Store> = {}): Store => ({
  id: 'user-a',
  name: 'Loja A',
  slug: 'loja-a',
  description: 'Descrição',
  logo: '',
  banner: '',
  primaryColor: '',
  plan: 'free',
  ownerEmail: 'old@example.com',
  address: 'Rua A',
  contact: '11999999999',
  keywords: ['local'],
  offerImages: [],
  status: 'closed',
  ...overrides,
});

class MemoryStorage implements UserStoreCacheStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('user store cache', () => {
  test('stores and restores a versioned pending-sync entry', () => {
    const storage = new MemoryStorage();
    saveUserStoreCache(storage, 'user-a', store(), true);

    const entry = loadUserStoreCache(
      storage,
      'user-a',
      'current@example.com'
    );

    assert.equal(entry?.pendingSync, true);
    assert.equal(entry?.store.name, 'Loja A');
    assert.equal(entry?.store.ownerEmail, 'current@example.com');
  });

  test('migrates the legacy plain Store cache and retries cloud sync', () => {
    const legacyValue = JSON.stringify(store());
    const entry = parseUserStoreCache(
      legacyValue,
      'user-a',
      'current@example.com'
    );

    assert.equal(entry?.version, 1);
    assert.equal(entry?.pendingSync, true);
    assert.equal(entry?.store.id, 'user-a');
  });

  test('rejects cache data from another authenticated user', () => {
    const value = serializeUserStoreCache(store({ id: 'user-b' }), false);
    const entry = parseUserStoreCache(value, 'user-a', 'a@example.com');

    assert.equal(entry, null);
  });

  test('normalizes malformed optional arrays and coordinates', () => {
    const value = JSON.stringify({
      version: 1,
      pendingSync: false,
      store: {
        ...store(),
        keywords: ['valid', 42],
        offerImages: 'invalid',
        lat: 'invalid',
        lng: Number.POSITIVE_INFINITY,
      },
    });

    const entry = parseUserStoreCache(value, 'user-a', 'a@example.com');

    assert.deepEqual(entry?.store.keywords, ['valid']);
    assert.deepEqual(entry?.store.offerImages, []);
    assert.equal(entry?.store.lat, undefined);
    assert.equal(entry?.store.lng, undefined);
  });

  test('uses a deterministic cache key per Firebase UID', () => {
    assert.equal(getUserStoreCacheKey('user-a'), 'kyrub_user_store_user-a');
    assert.notEqual(
      getUserStoreCacheKey('user-a'),
      getUserStoreCacheKey('user-b')
    );
  });
});
