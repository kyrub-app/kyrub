import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const nativeProfileSource = readFileSync(
  'src/components/ProfileSocialHubNative.tsx',
  'utf8'
);

describe('profile DOM containment', () => {
  test('replaces the emergency rollback with one React-owned profile panel', () => {
    assert.match(appSource, /<ProfileSocialHubNative\s*\/?>/);
    assert.doesNotMatch(appSource, /profileDomEnhancementsEnabled/);
    assert.doesNotMatch(appSource, /ProfileSocialHubBridge/);
    assert.doesNotMatch(appSource, /ProfileSocialPolishBridge/);
    assert.doesNotMatch(appSource, /ProfileMarkedNavigationRecoveryBridge/);
    assert.doesNotMatch(appSource, /ProfileStatusCheckboxBridge/);
    assert.doesNotMatch(appSource, /ProfileSocialMobileFirstBridge/);
    assert.doesNotMatch(appSource, /ProfileConnectionSubtabsBridge/);
    assert.doesNotMatch(appSource, /ProfileConnectedGroupsBridge/);
    assert.doesNotMatch(appSource, /ProfileConnectedCardOrganizationBridge/);
    assert.doesNotMatch(appSource, /ProfileSocialPostActionsBridge/);
    assert.doesNotMatch(nativeProfileSource, /MutationObserver/);
    assert.match(nativeProfileSource, /document\.addEventListener\('click'/);
    assert.match(nativeProfileSource, /#header-user-profile-trigger/);
  });
});
