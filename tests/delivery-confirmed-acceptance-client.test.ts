import assert from 'node:assert/strict';
import {test} from 'node:test';
import {confirmKyrubDeliveryAcceptance} from '../src/utils/deliveryOpportunities';
test('only matching authoritative receipt confirms a courier acceptance',async()=>{
 const id='order-'+'a'.repeat(64),uid='courier-fixture',user={uid,getIdToken:async()=> 'fixture-token'};
 const original=globalThis.fetch;
 const receipt={accepted:true,deliveryId:id,courierId:uid,status:'accepted'};
 let calls=0;
 try{
  globalThis.fetch=async(input,init)=>{
   calls++;assert.equal(input,'/api/delivery-opportunities/'+id+'/accept');
   assert.equal(init?.method,'POST');assert.deepEqual(JSON.parse(String(init?.body)),{confirmed:true});
   return Response.json(receipt);
  };
  await confirmKyrubDeliveryAcceptance(id,user);assert.equal(calls,1);
  await assert.rejects(confirmKyrubDeliveryAcceptance('bad',user));assert.equal(calls,1);
  for(const value of [{...receipt,accepted:false},{...receipt,courierId:'other'},{...receipt,deliveryId:'other'},{...receipt,status:'done'},{}]){
   globalThis.fetch=async()=>Response.json(value);
   await assert.rejects(confirmKyrubDeliveryAcceptance(id,user));
  }
  globalThis.fetch=async()=>new Response('<html>fallback</html>',{status:200});
  await assert.rejects(confirmKyrubDeliveryAcceptance(id,user));
  globalThis.fetch=async()=>new Response(null,{status:204});
  await assert.rejects(confirmKyrubDeliveryAcceptance(id,user));
  globalThis.fetch=async()=>Response.json({error:'disabled'},{status:503});
  await assert.rejects(confirmKyrubDeliveryAcceptance(id,user));
 }finally{globalThis.fetch=original;}
});
