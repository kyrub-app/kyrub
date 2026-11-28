import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {storeOrderDistributionEnabled,isIntegratedStoreDelivery,mayAcceptNewDelivery} from '../shared/storeOrderDistributionPolicy.js';
import {publishKyrubDeliveryOpportunity,escalateUnacceptedKyrubDeliveries} from '../server/delivery/deliveryOpportunityRouter.js';
import {listPublicDeliveryOpportunities} from '../server/delivery/publicDeliveryDiscoveryService.js';
test('launch suspension blocks integrated origin and order id without blocking independent origin',()=>{
 assert.equal(storeOrderDistributionEnabled(),false);
 assert.equal(isIntegratedStoreDelivery({id:'x',source:'kyrub-order'}),true);
 assert.equal(mayAcceptNewDelivery({id:'order-old',source:'manual'}),false);
 assert.equal(mayAcceptNewDelivery({id:'x',source:'kyrub-order'}),false);
 assert.equal(mayAcceptNewDelivery({id:'manual-x',source:'manual'}),true);
});
test('publication, escalation and public discovery stop without calling a provider or database',async()=>{
 await assert.rejects(publishKyrubDeliveryOpportunity('fictional-store','fictional-order'),/STORE_ORDER_DISTRIBUTION_DISABLED/);
 assert.deepEqual(await escalateUnacceptedKyrubDeliveries(),{checked:0,escalated:0,cancelled:0});
 assert.deepEqual(await listPublicDeliveryOpportunities(),{opportunities:[]});
});
test('new claim gate is before transaction create, after existing replay; UI prevents new integrated offers',()=>{
 const router=readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
 const replay=router.indexOf('if (courierId === actor.uid) return;');
 const gate=router.indexOf('if(!mayAcceptNewDelivery({id:normalizedId,source:delivery.source}))');
 const claim=router.indexOf('transaction.create(claimReference');
 assert.ok(replay>=0&&gate>replay&&claim>gate);
 for(const path of ['src/components/tabs/RendaTab.tsx','src/components/modals/DeliveryManagerModal.tsx'])assert.match(readFileSync(path,'utf8'),/mayAcceptNewDelivery/);
 assert.match(readFileSync('src/components/store/KyrubDeliveryOpportunityBridge.tsx','utf8'),/if\(storeOrderDistributionEnabled\(\)\)unsubscribeOrders = onSnapshot/);
});

test('new store-order acceptance cannot select integrated routing while exact accepted replay survives',async()=>{
 const {assertStoreOrderDeliveryChoice}=await import('../shared/storeOrderDistributionPolicy.js');
 for(const persistedProvider of ['', 'kyrub','merchant']){
  assert.throws(()=>assertStoreOrderDeliveryChoice({requestedProvider:'kyrub',persistedProvider,currentStatus:'pending'}),/STORE_ORDER_DISTRIBUTION_DISABLED/);
 }
 assert.doesNotThrow(()=>assertStoreOrderDeliveryChoice({requestedProvider:'merchant',persistedProvider:'',currentStatus:'pending'}));
 assert.doesNotThrow(()=>assertStoreOrderDeliveryChoice({requestedProvider:'kyrub',persistedProvider:'kyrub',currentStatus:'accepted'}));
 assert.throws(()=>assertStoreOrderDeliveryChoice({requestedProvider:'kyrub',persistedProvider:'merchant',currentStatus:'accepted'}),/STORE_ORDER_DISTRIBUTION_DISABLED/);
 const {mapOrderStatusExecutionError}=await import('../server/inventory/orderStatusExecutionServiceBase.js');
 assert.equal(mapOrderStatusExecutionError(new Error('STORE_ORDER_DISTRIBUTION_DISABLED')).status,409);
 const svc=readFileSync('server/inventory/orderInventoryService.ts','utf8');
 assert.match(svc,/adminDb\.runTransaction[\s\S]*?assertStoreOrderDeliveryChoice\(\{requestedProvider,persistedProvider,currentStatus:order.status\}\)/);
 const ui=readFileSync('src/components/customer/CustomerOrderInbox.tsx','utf8');
 assert.match(ui,/storeOrderDistributionEnabled\(\) && <button[^\n]*confirmDeliveryProvider\('kyrub'\)/);
 assert.match(ui,/confirmDeliveryProvider\('merchant'\)/);
});
