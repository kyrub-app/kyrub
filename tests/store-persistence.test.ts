import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Store } from '../src/types';
import {
  buildConfiguredStore,
  getUserStoreCacheKey,
  getUserStorePendingKey,
  hasPendingUserStoreSync,
  loadCachedUserStore,
  normalizeCachedStore,
  saveCachedUserStore,
  slugifyStoreName,
  type StorageLike,
} from '../src/utils/storePersistence';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

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

const store = (overrides: Partial<Store> = {}): Store => ({
  id: 'user-a',
  name: 'Loja A',
  slug: 'loja-a',
  description: 'Descrição',
  logo: '',
  banner: '',
  primaryColor: '',
  plan: 'free',
  ownerEmail: 'owner@example.com',
  address: 'Rua A',
  contact: '11999999999',
  keywords: ['local'],
  offerImages: [],
  status: 'closed',
  ...overrides,
});

describe('store persistence cache', () => {
  test('isolates cached stores and pending state by Firebase UID', () => {
    const storage = new MemoryStorage();
    saveCachedUserStore(storage, 'user-a', store(), true);

    assert.equal(
      loadCachedUserStore(storage, 'user-a', 'new@example.com')?.name,
      'Loja A'
    );
    assert.equal(
      loadCachedUserStore(storage, 'user-a', 'new@example.com')?.ownerEmail,
      'new@example.com'
    );
    assert.equal(hasPendingUserStoreSync(storage, 'user-a'), true);
    assert.equal(loadCachedUserStore(storage, 'user-b', ''), null);
    assert.notEqual(
      getUserStoreCacheKey('user-a'),
      getUserStoreCacheKey('user-b')
    );
    assert.notEqual(
      getUserStorePendingKey('user-a'),
      getUserStorePendingKey('user-b')
    );
  });

  test('clears only the pending marker after a successful cloud sync', () => {
    const storage = new MemoryStorage();
    saveCachedUserStore(storage, 'user-a', store(), true);
    saveCachedUserStore(storage, 'user-a', store(), false);

    assert.equal(hasPendingUserStoreSync(storage, 'user-a'), false);
    assert.equal(loadCachedUserStore(storage, 'user-a', '')?.name, 'Loja A');
  });

  test('normalizes malformed optional fields without leaking another id', () => {
    const normalized = normalizeCachedStore(
      {
        id: 'other-user',
        name: 'Loja',
        keywords: ['valid', 42] as unknown as string[],
        offerImages: 'invalid' as unknown as string[],
        lat: Number.POSITIVE_INFINITY,
      },
      'user-a',
      'owner@example.com'
    );

    assert.equal(normalized.id, 'user-a');
    assert.deepEqual(normalized.keywords, ['valid']);
    assert.deepEqual(normalized.offerImages, []);
    assert.equal(normalized.lat, undefined);
  });

  test('builds a deterministic store profile and slug from controlled fields', () => {
    const configured = buildConfiguredStore(
      store(),
      { uid: 'user-a', email: 'owner@example.com' },
      {
        name: '  Café São João  ',
        description: '  Descrição pública  ',
        address: '  Rua Central  ',
        contact: '  11999999999  ',
        keywords: [' Café ', ' bairro ', ''],
      }
    );

    assert.equal(configured.name, 'Café São João');
    assert.equal(configured.slug, 'cafe-sao-joao');
    assert.equal(configured.description, 'Descrição pública');
    assert.equal(configured.address, 'Rua Central');
    assert.equal(configured.contact, '11999999999');
    assert.deepEqual(configured.keywords, ['café', 'bairro']);
  });

  test('slugification removes accents and unsafe separators', () => {
    assert.equal(slugifyStoreName(' Açúcar & Afeto '), 'acucar-afeto');
  });
});
