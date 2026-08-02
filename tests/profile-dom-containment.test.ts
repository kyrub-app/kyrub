import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');

describe('profile DOM containment', () => {
  test('keeps the native profile hub mounted while unstable DOM bridges are disabled', () => {
    assert.match(appSource, /<ProfileSocialHubBridge\s*\/?>/);
    assert.match(appSource, /const profileDomEnhancementsEnabled = false/);
    assert.match(
      appSource,
      /\{profileDomEnhancementsEnabled && \([\s\S]*<ProfileSocialPolishBridge[\s\S]*<ProfileMarkedNavigationRecoveryBridge[\s\S]*<ProfileStatusCheckboxBridge[\s\S]*<ProfileConnectionSubtabsBridge[\s\S]*<ProfileConnectedGroupsBridge[\s\S]*\)\}/
    );
    assert.ok(
      appSource.indexOf('<ProfileSocialHubBridge') <
        appSource.indexOf('{profileDomEnhancementsEnabled &&')
    );
  });
});
