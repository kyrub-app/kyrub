import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modalLayoutSource = readFileSync(
  'src/components/AppModalLayoutBridge.tsx',
  'utf8'
);
const mobileMenuSource = readFileSync(
  'src/components/MobileErpMenu.tsx',
  'utf8'
);
const cartDrawerSource = readFileSync(
  'src/components/modals/B2CCartDrawer.tsx',
  'utf8'
);
const notificationCenterSource = readFileSync(
  'src/components/UserNotificationCenterBridge.tsx',
  'utf8'
);
const storeChatSource = readFileSync(
  'src/components/store/StoreCustomerChatModal.tsx',
  'utf8'
);

test('global modal layout skips self-managed drawers, popovers and viewport panels', () => {
  assert.ok(modalLayoutSource.includes('usesSelfManagedOverlayLayout'));
  assert.ok(
    modalLayoutSource.includes("overlay.dataset.kyrubSkipTopOverlay === 'true'")
  );
  assert.ok(modalLayoutSource.includes("hasClassToken(overlay, 'justify-end')"));
  assert.ok(modalLayoutSource.includes("hasClassToken(panel, 'h-full')"));
  assert.ok(modalLayoutSource.includes("hasClassToken(panel, 'absolute')"));
  assert.ok(modalLayoutSource.includes("hasClassToken(panel, 'h-[100dvh]')"));
  assert.ok(
    modalLayoutSource.includes(
      'if (!panel || usesSelfManagedOverlayLayout(overlay, panel)) return;'
    )
  );

  assert.ok(mobileMenuSource.includes('data-kyrub-skip-top-overlay="true"'));
  assert.ok(mobileMenuSource.includes('absolute inset-y-0 right-0'));

  assert.ok(cartDrawerSource.includes('fixed inset-0 z-50 flex justify-end'));
  assert.ok(cartDrawerSource.includes('flex h-full w-full max-w-md'));

  assert.ok(notificationCenterSource.includes('id="canonical-notification-center"'));
  assert.ok(notificationCenterSource.includes('className="absolute inset-x-2 top-'));

  assert.ok(storeChatSource.includes('id="store-customer-chat-modal"'));
  assert.ok(storeChatSource.includes('h-[100dvh]'));
});
