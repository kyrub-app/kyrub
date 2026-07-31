import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const modalLayoutSource = readFileSync(
  'src/components/AppModalLayoutBridge.tsx',
  'utf8'
);
const postActionsSource = readFileSync(
  'src/components/ProfileSocialPostActionsBridge.tsx',
  'utf8'
);
const socialRules = readFileSync(
  'firestore.social-feed.fragment.rules',
  'utf8'
);

describe('profile modal layout and post actions', () => {
  test('mounts the global modal layout and social action bridges', () => {
    assert.match(appSource, /AppModalLayoutBridge/);
    assert.match(appSource, /ProfileSocialPostActionsBridge/);
    assert.ok(
      appSource.indexOf('<AppModalLayoutBridge') <
        appSource.indexOf('<LegacyApp')
    );
    assert.ok(
      appSource.indexOf('<ProfileSocialPostActionsBridge') <
        appSource.indexOf('<LegacyApp')
    );
  });

  test('top-aligns real overlays with safe viewport margins', () => {
    assert.match(modalLayoutSource, /querySelectorAll<HTMLElement>\('\.fixed\.inset-0'\)/);
    assert.match(modalLayoutSource, /data-kyrub-top-overlay/);
    assert.match(modalLayoutSource, /align-items: flex-start !important/);
    assert.match(modalLayoutSource, /safe-area-inset-top/);
    assert.match(modalLayoutSource, /max-height: calc\(/);
    assert.match(modalLayoutSource, /100dvh - 24px/);
    assert.match(modalLayoutSource, /border-radius: 24px !important/);
  });

  test('raises tiny modal typography to the application reading scale', () => {
    assert.match(modalLayoutSource, /class~="text-\[8px\]"/);
    assert.match(modalLayoutSource, /font-size: 0\.75rem !important/);
    assert.match(modalLayoutSource, /class~="text-\[10px\]"/);
    assert.match(modalLayoutSource, /font-size: 0\.875rem !important/);
    assert.match(modalLayoutSource, /\[data-kyrub-top-panel="true"\] input/);
    assert.match(modalLayoutSource, /font-size: 1rem !important/);
  });

  test('moves the compact like action before save and hides the old full-width button', () => {
    assert.match(postActionsSource, /data-kyrub-original-like/);
    assert.match(postActionsSource, /display: none !important/);
    assert.match(postActionsSource, /data-kyrub-like-proxy/);
    assert.match(postActionsSource, /const anchor = saveButton \?\? menuButton/);
    assert.match(postActionsSource, /actionGroup\.insertBefore\(proxy, anchor\)/);
    assert.match(postActionsSource, /Curtir publicação/);
    assert.match(postActionsSource, /Remover curtida/);
  });

  test('adds a two-step owner delete action and removes local and cloud state', () => {
    assert.match(postActionsSource, /data-kyrub-delete-post/);
    assert.match(postActionsSource, /Toque novamente para excluir/);
    assert.match(postActionsSource, /deleteDoc\(doc\(db, 'social_posts', post\.id\)\)/);
    assert.match(postActionsSource, /kyrub-social-posts-updated/);
    assert.match(postActionsSource, /restoreStorageValue/);
    assert.match(postActionsSource, /Publicação excluída/);
    assert.match(
      socialRules,
      /allow delete: if isSignedIn\(\)[\s\S]{0,120}existing\(\)\.authorId == request\.auth\.uid/
    );
  });
});
