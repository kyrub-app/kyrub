import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MAX_STORE_BANNER_IMAGES,
  MAX_STORE_GALLERY_IMAGES,
  normalizeStoreMediaImages,
  storeBannerImages,
  storeGalleryImages,
} from '../src/utils/storeMediaCollections';
import { buildMarketplaceStoreCreateData, buildMarketplaceStoreUpdateData } from '../src/utils/marketplaceDocuments';
import { buildUserStoreCreateData, buildUserStoreUpdateData } from '../src/utils/userStoreDocument';
import { normalizeCachedStore } from '../src/utils/storePersistence';

const source=(path:string)=>readFileSync(path,'utf8');
const photo=(n:number)=>'https://example.com/image-'+n+'.jpg';

test('legacy single banner survives, carousel bounded to five, gallery independent',()=>{
  assert.equal(MAX_STORE_BANNER_IMAGES,5);
  assert.equal(MAX_STORE_GALLERY_IMAGES,24);
  assert.deepEqual(storeBannerImages({banner:photo(1)}),[photo(1)]);
  assert.deepEqual(storeBannerImages({banner:photo(1),bannerImages:[]}),[]);
  assert.deepEqual(
    normalizeStoreMediaImages([photo(1),photo(2),photo(1),'javascript:alert(1)','//host/test',photo(3),photo(4),photo(5),photo(6)],5),
    [photo(1),photo(2),photo(3),photo(4),photo(5)]
  );
  assert.deepEqual(storeGalleryImages({galleryImages:[photo(7),photo(8)]}),[photo(7),photo(8)]);
  assert.deepEqual(storeGalleryImages({galleryImages:'invalid'}),[]);
});

test('store media remains in persistence and marketplace publication, including first verified store',()=>{
  const data={store:{
    id:'owner_media_test',ownerId:'owner_media_test',name:'Galeria',slug:'galeria',
    description:'',address:'',logo:'',banner:photo(1),bannerImages:[photo(1),photo(2)],
    galleryImages:[photo(4),photo(5)],primaryColor:'#f97316',keywords:[],
    status:'open' as const,
  },publicationStatus:'published' as const};
  const create=buildMarketplaceStoreCreateData(data);
  const update=buildMarketplaceStoreUpdateData(data);
  assert.deepEqual(create.bannerImages,[photo(1),photo(2)]);
  assert.deepEqual(create.galleryImages,[photo(4),photo(5)]);
  assert.deepEqual(update.bannerImages,[photo(1),photo(2)]);
  assert.deepEqual(update.galleryImages,[photo(4),photo(5)]);
  const sync=source('server/gamification/firstStorePublicationAuthority.ts');
  assert.equal((sync.match(/bannerImages: Array\.isArray\(p\.bannerImages\)/g)||[]).length,2);
  assert.equal((sync.match(/galleryImages: Array\.isArray\(p\.galleryImages\)/g)||[]).length,2);
  const persistence=source('src/utils/storePersistence.ts');
  assert.ok(persistence.includes('bannerImages: storeBannerImages(store)'));
  assert.ok(persistence.includes('galleryImages: storeGalleryImages(store)'));
  const projection=source('server/payments/marketplaceDiscoveryService.ts');
  assert.ok(projection.includes('bannerImages: stringList(storeData.bannerImages)'));
  assert.ok(projection.includes('galleryImages: stringList(storeData.galleryImages)'));
  assert.ok(projection.includes('bannerImages: stringList(legacyData.bannerImages)'));
  assert.ok(projection.includes('galleryImages: stringList(legacyData.galleryImages)'));
});

test('ERP uses real existing image upload/pickers, separate sections, and removes stray coupon button',()=>{
  const modal=source('src/components/modals/StoreConfigModal.tsx');
  const editor=source('src/components/store/StoreMediaCollectionEditor.tsx');
  const coupon=source('src/components/store/StoreCouponRedemptionBridge.tsx');
  const app=source('src/components/PublicStorefrontQuickPanel.tsx');
  const hero=source('src/components/PublicStorefrontHero.tsx');
  assert.ok(modal.includes('id="store-banner-images-editor"'));
  assert.ok(modal.includes('id="store-gallery-images-editor"'));
  assert.ok(modal.includes('setConfigBannerImages'));
  assert.ok(modal.includes('setConfigGalleryImages'));
  assert.ok(editor.includes('GooglePhotosImagePickerButton'));
  assert.ok(editor.includes('GoogleDriveImagePickerButton'));
  assert.ok(editor.includes('deviceLabel="Dispositivo"'));
  assert.ok(editor.includes('Mover imagem'));
  assert.ok(editor.includes('Remover imagem'));
  assert.ok(coupon.includes("document.getElementById('kyrub-store-coupon-redemption-host')"));
  assert.ok(!coupon.includes("document.getElementById('kyrub-store-save-publish-actions')"));
  assert.ok(hero.includes("id:'galeria',label:'Galeria'"));
  assert.ok(!hero.includes("id:'politicas'"));
  assert.ok(app.includes("selected==='galeria'"));
  assert.ok(app.includes('id="public-storefront-policies-inside-info"'));
  assert.ok(!app.includes("selected==='politicas'"));
});

test('Firestore image allowlists are optional for legacy docs, bounded for new stores and listings',()=>{
  const rules=source('firestore.rules');
  const marketplace=source('firestore.marketplace.fragment.rules');
  for(const raw of [rules,marketplace]){
    assert.ok(raw.includes("data.keys().hasAny(['bannerImages'])"));
    assert.ok(raw.includes('data.bannerImages.size() <= 5'));
    assert.ok(raw.includes("data.keys().hasAny(['galleryImages'])"));
    assert.ok(raw.includes('data.galleryImages.size() <= 24'));
  }
  const deploy=source('.github/workflows/deploy-community-preview-security.yml');
  assert.ok(deploy.includes("'firestore.rules'"));
  assert.ok(deploy.includes("'firestore.marketplace.fragment.rules'"));
  assert.ok(deploy.includes('firebase-production'));
});

test('public banner excludes product showcase photos and keeps the catalog unaffected',()=>{
  const hero=source('src/components/PublicStorefrontHero.tsx');
  assert.ok(hero.includes('storeBannerImages(store)'));
  assert.ok(!hero.includes('store.offerImages'));
  const quickPanel=source('src/components/PublicStorefrontQuickPanel.tsx');
  assert.ok(quickPanel.includes('storeGalleryImages(store)'));
  const storefront=source('src/components/PublicStorefrontApp.tsx');
  assert.ok(storefront.includes('bannerImages: string[]'));
  assert.ok(storefront.includes('galleryImages: string[]'));
});

test('manager media updates use transactional server authorization, not owner profile access',()=>{
  const service=source('server/staff/storeMediaService.ts');
  const transport=source('server/staff/storeMediaTransport.ts');
  const runtime=source('src/LegacyApp.tsx');
  const menu=source('src/components/MobileErpMenu.tsx');
  const modal=source('src/components/store/StoreManagerMediaModal.tsx');
  const ownerModal=source('src/components/modals/StoreConfigModal.tsx');
  const health=source('api/health.ts');
  const vercel=JSON.parse(source('vercel.json')) as {rewrites: {source:string;destination:string}[]};
  for(const expected of [
    'resolveStaffActor','adminDb.runTransaction','tx.get(memberRef)',
    "parsed.role!=='manager'","parsed.status!=='active'",
    "store.get('ownerId')","listing.get('ownerId')",
    "tenant.get('ownerId')","STORE_MEDIA_CONFLICT",
  ])assert.ok(service.includes(expected),'Missing manager protection: '+expected);
  assert.ok(service.includes("tx.update(primaryRef"));
  assert.ok(service.includes("tx.update(listingRef"));
  assert.ok(!service.includes('tx.update(storeRef'));
  assert.ok(!service.includes('FieldValue.delete()'));
  assert.ok(transport.includes('getStoreMediaForManager'));
  assert.ok(transport.includes('saveStoreMediaForManager'));
  assert.ok(health.includes("transport === 'store-media'"));
  assert.ok(vercel.rewrites.some(r=>r.source==='/api/staff/store-media'&&r.destination==='/api/health?transport=store-media'));
  assert.ok(menu.includes("if (itemId === 'loja') return role === 'manager'"));
  assert.ok(runtime.includes("<StoreManagerMediaModal"));
  assert.ok(runtime.includes("selectedStaffAccess?.role === 'manager'"));
  assert.ok(modal.includes('expectedVersion:media.version'));
  assert.ok(modal.includes('StoreMediaCollectionEditor'));
  assert.ok(ownerModal.includes("getDoc(doc(db, 'users', user.uid, 'stores', user.uid))"));
  assert.ok(ownerModal.includes('hasPendingUserStoreSync'));
});

test('merchant policies are optional, bounded and propagated through all storefront paths',()=>{
  const policies='Atendemos de segunda a sexta. Solicite trocas pelo chat da loja.';
  const userCreate=buildUserStoreCreateData({
    uid:'owner_policy',ownerEmail:'owner@example.com',
    name:'Loja',slug:'loja',description:'',policies,
    logo:'',banner:'',primaryColor:'#f97316',keywords:[],offerImages:[],
    address:'',contact:'',status:'open',
  });
  assert.equal(userCreate.policies,policies);
  assert.equal(buildUserStoreUpdateData({policies:''}).policies,'');
  assert.throws(()=>buildUserStoreUpdateData({policies:'x'.repeat(2001)}),/2000/);
  assert.equal(normalizeCachedStore({policies},'owner_policy','owner@example.com').policies,policies);
  assert.equal(normalizeCachedStore({},'owner_policy','owner@example.com').policies,'');

  const payload={store:{
    id:'owner_policy',ownerId:'owner_policy',name:'Loja',slug:'loja',
    description:'',policies,address:'',logo:'',banner:'',primaryColor:'#f97316',
    keywords:[],status:'open' as const,
  },publicationStatus:'published' as const};
  assert.equal(buildMarketplaceStoreCreateData(payload).policies,policies);
  assert.equal(buildMarketplaceStoreUpdateData(payload).policies,policies);

  const sync=source('server/gamification/firstStorePublicationAuthority.ts');
  assert.equal((sync.match(/policies: typeof p\.policies/g)??[]).length,2);
  const persistence=source('src/utils/storePersistence.ts');
  assert.ok((persistence.match(/policies: store\.policies \?\? ''/g)??[]).length>=4);
  const projection=source('server/payments/marketplaceDiscoveryService.ts');
  assert.ok(projection.includes('policies: clean(storeData.policies)'));
  assert.ok(projection.includes('policies: clean(legacyData.policies)'));
  const quickPanel=source('src/components/PublicStorefrontQuickPanel.tsx');
  assert.ok(quickPanel.includes('store.policies?.trim()'));
  assert.ok(quickPanel.includes('whitespace-pre-wrap break-words'));
  assert.ok(!quickPanel.includes('Esta loja ainda não publicou políticas institucionais específicas'));

  for(const rule of ['firestore.rules','firestore.marketplace.fragment.rules']){
    const content=source(rule);
    assert.ok(content.includes("data.keys().hasAny(['policies'])"));
    assert.ok(content.includes('data.policies.size() <= 2000'));
  }
});
