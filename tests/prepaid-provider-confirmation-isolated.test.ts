import assert from 'node:assert/strict';
import test, {beforeEach} from 'node:test';
import {build} from 'esbuild';
const state = {payment:{} as any, binding:{} as any};
(globalThis as any).__prepaidProviderTest = state;
const modules: Record<string,string> = {
  'mercadoPagoStoreOauthService.js': 'export const mercadoPagoStoreRequest = async()=>globalThis.__prepaidProviderTest.payment; export const validateMercadoPagoStoreConnection = async()=>({});',
  'paymentProviderBindingService.js': 'export const loadMercadoPagoPaymentProviderBinding = async()=>globalThis.__prepaidProviderTest.binding; export const saveMercadoPagoPaymentProviderBinding = async()=>{};',
  'commercialRecipientAuthorityService.js': 'export const resolveCommercialRecipientAuthority = async()=>({credentialScopeId:"seller",externalAccountId:"collector"});',
  'mercadoPagoPixProvider.js': 'export const verifyMercadoPagoWebhookSignature = async()=>{};',
};
const bundle = await build({entryPoints:['server/payments/mercadoPagoStoreScopedProvider.ts'],bundle:true,
  platform:'node',format:'esm',write:false,plugins:[{name:'isolated-provider',setup(plugin){
    plugin.onResolve({filter:/\.js$/},args=>{const name=args.path.split('/').at(-1)!;return modules[name]?{path:name,namespace:'isolated-provider'}:undefined;});
    plugin.onLoad({filter:/.*/,namespace:'isolated-provider'},args=>({contents:modules[args.path],loader:'js'}));
  }}]});
const {reconcileStoreScopedMercadoPagoPaymentEvent: reconcile} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=isolated-prepaid-provider.js').toString('base64')}`);
beforeEach(()=>{
  state.binding={providerPaymentId:'psp',legacyStoreId:'seller',canonicalStoreId:'store',paymentId:'payment',paymentIntentId:'intent',recipientAccountId:'collector'};
  state.payment={id:'psp',collector_id:'collector',status:'approved',status_detail:'accredited',transaction_amount:20,
    currency_id:'BRL',payment_method_id:'pix',date_last_updated:'2026-11-06T12:00:00.000Z',
    metadata:{kyrub_payment_intent_id:'intent',kyrub_store_id:'store',kyrub_payment_id:'payment'}};
});
test('accredited payment under original receiver and binding produces trusted confirmation',async()=>{
  const event=await reconcile('psp');
  assert.equal(event.eventType,'payment.paid');
  assert.equal(event.recipientAccountId,'collector');
  assert.equal(event.signatureVerified,true);
});
test('approved but unaccredited payment does not produce confirmation',async()=>{
  state.payment.status_detail='pending';assert.equal(await reconcile('psp'),null);
});
for(const [field,value] of [['collector_id','other'],['currency_id','USD'],['payment_method_id','card'],['id','other']] as const)
  test(`reject actual PSP mismatch in ${field}`,async()=>{state.payment[field]=value;await assert.rejects(reconcile('psp'));});
for(const field of ['kyrub_store_id','kyrub_payment_id','kyrub_payment_intent_id'])
  test(`reject metadata mismatch ${field}`,async()=>{state.payment.metadata[field]='other';await assert.rejects(reconcile('psp'));});
test('binding cannot switch the credential scope',async()=>{state.binding.legacyStoreId='other';await assert.rejects(reconcile('psp'));});
