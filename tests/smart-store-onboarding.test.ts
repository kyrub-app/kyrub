import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clearStoreOnboardingDraft,
  createStoreOnboardingDraft,
  getStoreOnboardingDraftKey,
  getStoreOnboardingProgress,
  loadStoreOnboardingDraft,
  saveStoreOnboardingDraft,
  shouldOfferStoreOnboarding,
  type StoreOnboardingProfile,
} from '../src/utils/smartStoreOnboarding';

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

const emptyProfile: StoreOnboardingProfile = {
  name: '',
  description: '',
  address: '',
  contact: '',
  keywords: '',
};

describe('smart store onboarding', () => {
  test('prioritizes missing required data without asking again for known values', () => {
    const progress = getStoreOnboardingProgress({
      ...emptyProfile,
      name: 'City Chopperia',
      description: 'Burgers e chopp',
      address: 'Rua Central, 10',
    });

    assert.equal(progress.completed, 3);
    assert.equal(progress.percent, 60);
    assert.equal(progress.nextField, 'contact');
    assert.equal(progress.readyForReview, false);
    assert.equal(progress.steps.find(step => step.id === 'name')?.complete, true);
  });

  test('allows review when minimum activation profile is present', () => {
    const profile = {
      ...emptyProfile,
      name: 'City Chopperia',
      contact: '(11) 99999-9999',
    };
    const progress = getStoreOnboardingProgress(profile);

    assert.equal(progress.readyForReview, true);
    assert.equal(progress.nextField, 'description');
    assert.equal(shouldOfferStoreOnboarding(profile), true);
  });

  test('stops offering completion when all profile fields are complete', () => {
    const profile: StoreOnboardingProfile = {
      name: 'City Chopperia',
      description: 'Burgers e chopp',
      address: 'Rua Central, 10',
      contact: '(11) 99999-9999',
      keywords: 'burger, chopp',
    };

    const progress = getStoreOnboardingProgress(profile);
    assert.equal(progress.percent, 100);
    assert.equal(progress.nextField, null);
    assert.equal(progress.readyForReview, true);
    assert.equal(shouldOfferStoreOnboarding(profile), false);
  });

  test('persists only navigation state for resuming, never a duplicate store profile', () => {
    const storage = new MemoryStorage();
    const draft = createStoreOnboardingDraft(
      'address',
      new Date('2026-08-20T18:00:00.000Z')
    );

    saveStoreOnboardingDraft(storage, 'user-1', draft);
    const serialized = storage.getItem(getStoreOnboardingDraftKey('user-1')) ?? '';
    const restored = loadStoreOnboardingDraft(storage, 'user-1');

    assert.deepEqual(restored, draft);
    assert.equal(serialized.includes('City Chopperia'), false);
    assert.equal(serialized.includes('profile'), false);

    clearStoreOnboardingDraft(storage, 'user-1');
    assert.equal(loadStoreOnboardingDraft(storage, 'user-1'), null);
  });

  test('ignores malformed or future draft payloads safely', () => {
    const storage = new MemoryStorage();
    storage.setItem(getStoreOnboardingDraftKey('user-1'), '{bad');
    assert.equal(loadStoreOnboardingDraft(storage, 'user-1'), null);

    storage.setItem(
      getStoreOnboardingDraftKey('user-1'),
      JSON.stringify({ version: 99, lastField: 'name', updatedAt: new Date().toISOString() })
    );
    assert.equal(loadStoreOnboardingDraft(storage, 'user-1'), null);
  });
});
