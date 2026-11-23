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
