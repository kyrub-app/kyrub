import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = (path: string) => readFileSync(path,'utf8');
const rewrites = JSON.parse(read('vercel.json')).rewrites as Array<{source:string;destination:string}>;
const mapped = new Map(rewrites.map(route=>[route.source,route.destination]));
const serverless = read('server/notifications/userNotificationsServerlessTransport.ts');
const router = read('server/notifications/userNotificationRouter.ts');
const service = read('server/payments/orderCreditInterestService.ts');
const storefront = read('src/components/PublicStorefrontApp.tsx');

test('the existing header bell has a production serverless route without a new function',()=>{
  assert.equal(mapped.get('/api/notifications'),'/api/health?transport=user-notifications');
  assert.equal(mapped.get('/api/notifications/:path*'),'/api/health?transport=user-notifications&path=:path*');
  assert.match(read('api/health.ts'),/handleUserNotificationsServerlessRequest/);
  assert.match(serverless,/createUserNotificationRouter/);
  assert.match(serverless,/app.use\('\/api\/notifications'/);
  assert.doesNotMatch(serverless,/\.listen\(/);
  assert.match(router,/recipientUserId: identity\.uid/);
  assert.match(router,/markUserNotificationRead/);
  assert.match(router,/markAllUserNotificationsRead/);
});
test('other already-defined chat and preference endpoints reuse same transport',()=>{
  for(const [source,base] of [
    ['/api/store-chat','/api/health?transport=user-notifications&surface=store-chat'],
    ['/api/communication-preferences','/api/health?transport=user-notifications&surface=preferences'],
  ]) {
    assert.equal(mapped.get(source),base);
    assert.equal(mapped.get(source+'/:path*'),base+'&path=:path*');
  }
  assert.match(serverless,/createStoreCustomerChatRouter/);
  assert.match(serverless,/createUserCommunicationPreferenceRouter/);
});
test('the compensation event is scoped to the buyer inbox and resolves to the canonical storefront',()=>{
  assert.match(service,/recipientUserId: buyerId/);
  assert.match(service,/category: 'order'/);
  assert.match(service,/eventType: 'credit_interest_proposed'/);
  assert.match(service,/storeId: canonicalStoreId/);
  assert.match(service,/transaction\.create\(adminDb\.doc\(userNotificationPath\(buyerId, notification\.id\)\), notification\)/);
  assert.match(storefront,/<BuyerCreditInterestCard storeId=\{store\.id\} buyerId=\{user\.uid\}/);
});
