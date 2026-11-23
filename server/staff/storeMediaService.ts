import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { parseStoreMember } from '../../src/utils/storeSecurity.js';
import { resolveStaffActor } from './staffNoticeService.js';
import {
  MAX_STORE_BANNER_IMAGES, MAX_STORE_GALLERY_IMAGES,
  normalizeStoreMediaImages, storeBannerImages, storeGalleryImages,
} from '../../src/utils/storeMediaCollections.js';

const clean=(value:unknown):string=>typeof value==='string'?value.trim():'';
const safeId=(value:string):boolean=>/^[A-Za-z0-9_-]{1,128}$/.test(value);
type Media={logo:string;bannerImages:string[];galleryImages:string[];version:number};

const ensureManager=(role:string):void=>{
  if(role!=='owner'&&role!=='manager') throw Error('STORE_MEDIA_FORBIDDEN');
};
const ownerPrimaryRef=(owner:string)=>adminDb.doc('users/'+owner+'/stores/'+owner);
const storeListingRef=(owner:string)=>adminDb.doc('marketplace_listings/s_'+owner.length+'_'+owner);
const validateImage=(value:unknown):string=>{
  if(value==='')return '';
  const images=normalizeStoreMediaImages([value],1);
  if(images.length!==1)throw Error('STORE_MEDIA_INVALID');
  return images[0];
};
const validateImages=(value:unknown,max:number):string[]=>{
  if(!Array.isArray(value)||value.length>max)throw Error('STORE_MEDIA_INVALID');
  const images=normalizeStoreMediaImages(value,max);
  if(images.length!==value.length)throw Error('STORE_MEDIA_INVALID');
  return images;
};

export const getStoreMediaForManager=async(input:{
  authorization:string;legacyStoreId:string;
}):Promise<Media>=>{
  const actor=await resolveStaffActor(input.authorization,input.legacyStoreId);
  ensureManager(actor.role);
  const [primary,settings]=await Promise.all([
    ownerPrimaryRef(actor.legacyStoreId).get(),
    adminDb.doc('stores/'+actor.canonicalStoreId+'/settings/media').get(),
  ]);
  if(!primary.exists||clean(primary.get('ownerId'))!==actor.legacyStoreId)
    throw Error('STORE_MEDIA_NOT_FOUND');
  return {
    logo:clean(primary.get('logo')),
    bannerImages:storeBannerImages(primary.data()??{}),
    galleryImages:storeGalleryImages(primary.data()??{}),
    version:typeof settings.get('version')==='number'?settings.get('version'):0,
  };
};

export const saveStoreMediaForManager=async(input:{
  authorization:string;legacyStoreId:string;
  logo:unknown;bannerImages:unknown;galleryImages:unknown;expectedVersion:unknown;
}):Promise<Media>=>{
  const actor=await resolveStaffActor(input.authorization,input.legacyStoreId);
  ensureManager(actor.role);
  const logo=validateImage(input.logo);
  const bannerImages=validateImages(input.bannerImages,MAX_STORE_BANNER_IMAGES);
  const galleryImages=validateImages(input.galleryImages,MAX_STORE_GALLERY_IMAGES);
  const expectedVersion=Number(input.expectedVersion);
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)
    throw Error('STORE_MEDIA_INVALID');
  const storeRef=adminDb.doc('stores/'+actor.canonicalStoreId);
  const primaryRef=ownerPrimaryRef(actor.legacyStoreId);
  const listingRef=storeListingRef(actor.legacyStoreId);
  const tenantRef=adminDb.doc('tenants/'+actor.legacyStoreId);
  const memberRef=adminDb.doc('stores/'+actor.canonicalStoreId+'/members/'+actor.uid);
  const mediaRef=storeRef.collection('settings').doc('media');

  return adminDb.runTransaction(async tx=>{
    const [store,primary,listing,tenant,member,settings]=await Promise.all([
      tx.get(storeRef),tx.get(primaryRef),tx.get(listingRef),tx.get(tenantRef),
      actor.role==='manager'?tx.get(memberRef):Promise.resolve(null),
      tx.get(mediaRef),
    ]);
    if(!store.exists||clean(store.get('ownerId'))!==actor.legacyStoreId||
       !primary.exists||clean(primary.get('ownerId'))!==actor.legacyStoreId)
      throw Error('STORE_MEDIA_FORBIDDEN');
    if(actor.role==='manager'){
      const parsed=parseStoreMember(member?.data());
      if(!parsed||parsed.userId!==actor.uid||
        parsed.storeId!==actor.canonicalStoreId||
        parsed.status!=='active'||parsed.role!=='manager')throw Error('STORE_MEDIA_FORBIDDEN');
    }
    if(listing.exists&&(listing.get('ownerId')!==actor.legacyStoreId||
      listing.get('storeId')!==actor.legacyStoreId||
      listing.get('listingType')!=='store'))throw Error('STORE_MEDIA_FORBIDDEN');
    if(!tenant.exists||tenant.get('ownerId')!==actor.legacyStoreId||
      tenant.get('id')!==actor.legacyStoreId||
      tenant.get('canonicalStoreId')!==actor.canonicalStoreId)
      throw Error('STORE_MEDIA_FORBIDDEN');
    const currentVersion=typeof settings.get('version')==='number'?settings.get('version'):0;
    if(expectedVersion!==currentVersion)throw Error('STORE_MEDIA_CONFLICT');
    const media={
      logo,banner:bannerImages[0]??'',bannerImages,galleryImages,
    };
    if(clean(primary.get('logo'))===logo&&
      JSON.stringify(storeBannerImages(primary.data()??{}))===JSON.stringify(bannerImages)&&
      JSON.stringify(storeGalleryImages(primary.data()??{}))===JSON.stringify(galleryImages))
      return {...media,version:currentVersion};
    tx.update(primaryRef,{...media,updatedAt:FieldValue.serverTimestamp()});
    if(listing.exists)tx.update(listingRef,{...media,updatedAt:FieldValue.serverTimestamp()});
    if(tenant.exists)tx.update(tenantRef,{...media,updatedAt:FieldValue.serverTimestamp()});
    tx.set(mediaRef,{version:currentVersion+1,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid});
    return {logo,bannerImages,galleryImages,version:currentVersion+1};
  });
};
