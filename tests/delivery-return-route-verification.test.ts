import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  routeVerificationPolicy,parseGoogleRouteDistance,computeGoogleReturnRouteDistance,
} from '../server/delivery/deliveryReturnRouteVerificationService';

test('provider verification is disabled by default and distances are bounded',()=>{
  assert.equal(routeVerificationPolicy(null),null);
  assert.equal(routeVerificationPolicy({enabled:false,maxDistanceMeters:20000}),null);
  assert.equal(routeVerificationPolicy({enabled:true,maxDistanceMeters:0}),null);
  assert.equal(routeVerificationPolicy({enabled:true,maxDistanceMeters:20000}),20000);
  assert.equal(parseGoogleRouteDistance({routes:[{distanceMeters:4200}]},20000),4200);
  for(const value of [null,{}, {routes:[]},{routes:[{distanceMeters:-1}]},
    {routes:[{distanceMeters:20001}]},{routes:[{distanceMeters:2.5}]},
    {routes:[{distanceMeters:200},{distanceMeters:400}]}]){
    assert.throws(()=>parseGoogleRouteDistance(value,20000),/DELIVERY_RETURN_ROUTE_UNAVAILABLE/);
  }
});
test('Google Routes requests use only bounded original locations and vehicle-correct mode',async()=>{
  let calls=0;
  const request=async (_url:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
    calls++;
    assert.equal(_url,'https://routes.googleapis.com/directions/v2:computeRoutes');
    assert.equal(init?.method,'POST');
    const headers=init?.headers as Record<string,string>;
    assert.equal(headers['X-Goog-FieldMask'],'routes.distanceMeters');
    assert.equal(headers['X-Goog-Api-Key'],'test-key-not-real');
    const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
    assert.equal(body.computeAlternativeRoutes,false);
    assert.ok(['DRIVE','BICYCLE','TWO_WHEELER'].includes(String(body.travelMode)));
    assert.ok(!JSON.stringify(body).includes('test-key-not-real'));
    return new Response(JSON.stringify({routes:[{distanceMeters:5800}]}),{status:200});
  };
  const original={apiKey:'test-key-not-real',origin:{latitude:-23.55,longitude:-46.63},
    destination:'Rua de Teste 10, São Paulo, Brasil',maxMeters:20000,request};
  for(const vehicle of ['car','bicycle','motorcycle'] as const){
    assert.equal(await computeGoogleReturnRouteDistance({...original,vehicle}),5800);
  }
  assert.equal(calls,3);
  await assert.rejects(computeGoogleReturnRouteDistance({...original,vehicle:'car',
    origin:{latitude:1000,longitude:0}}),/DELIVERY_RETURN_ROUTE_UNAVAILABLE/);
  assert.equal(calls,3);
});
test('route estimate is isolated from return custody and financial settlements',()=>{
  const service=readFileSync('server/delivery/deliveryReturnRouteVerificationService.ts','utf8');
  const router=readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  const ui=readFileSync('src/components/admin/AdminDeliveryReturnEconomicsPreview.tsx','utf8');
  assert.match(service,/platformEconomicPolicies\/deliveryReturnRouteVerification/);
  assert.match(service,/resolvePlatformCredentials/);
  assert.match(service,/provider:'google_routes'/);
  assert.match(service,/protocol\.operatorId===operatorId/);
  assert.match(service,/adminDb\.runTransaction/);
  assert.doesNotMatch(service,/economicObligations|issueRefund|settleFunds|captureFunds/);
  assert.match(router,/\/admin\/returns\/:deliveryId\/route-distance\/verify/);
  assert.match(ui,/pode gerar custo Google/);
});
