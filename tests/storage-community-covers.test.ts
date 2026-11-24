import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'kyrub-identity-security-test';
const OWNER_ID = 'community_cover_owner';
const MEMBER_ID = 'community_cover_member';
let environment: RulesTestEnvironment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8090,
    },
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      host: '127.0.0.1',
      port: 9198,
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.clearStorage();
  await environment.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'communities', 'public_cover'), {
      ownerId: OWNER_ID,
      visibility: 'public',
    });
    await setDoc(doc(firestore, 'communities', 'private_cover'), {
      ownerId: OWNER_ID,
      visibility: 'private',
    });
    await setDoc(
      doc(
        firestore,
        'community_members',
        `private_cover__${MEMBER_ID}`
      ),
      {
        communityId: 'private_cover',
        userId: MEMBER_ID,
        status: 'active',
      }
    );
  });
});

after(async () => {
  await environment.cleanup();
});

const metadata = (communityId: string, ownerId = OWNER_ID) => ({
  contentType: 'image/jpeg',
  customMetadata: {
    communityId,
    ownerId,
  },
});

const appImageMetadata = (contentHash: string, ownerId = OWNER_ID) => ({
  contentType: 'image/webp',
  customMetadata: {
    ownerId,
    contentHash,
    originalName: 'produto.webp',
  },
});

test('community creator uploads, reads and removes the cover', async () => {
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();
  const cover = ref(
    ownerStorage,
    `community-covers/public_cover/${OWNER_ID}/cover.jpg`
  );
  await assertSucceeds(
    uploadBytes(cover, new Uint8Array([1, 2, 3]), metadata('public_cover'))
  );
  await assertSucceeds(getBytes(cover));
  await assertSucceeds(deleteObject(cover));
});

test('another profile reads a public cover but cannot replace it', async () => {
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();
  const path = `community-covers/public_cover/${OWNER_ID}/cover.jpg`;
  await assertSucceeds(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1]),
      metadata('public_cover')
    )
  );

  const visitorStorage = environment.authenticatedContext('visitor').storage();
  await assertSucceeds(getBytes(ref(visitorStorage, path)));
  await assertFails(
    uploadBytes(
      ref(visitorStorage, path),
      new Uint8Array([9]),
      metadata('public_cover')
    )
  );
});

test('private covers are visible only to the owner and active members', async () => {
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();
  const path = `community-covers/private_cover/${OWNER_ID}/cover.jpg`;
  await assertSucceeds(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1]),
      metadata('private_cover')
    )
  );

  const memberStorage = environment.authenticatedContext(MEMBER_ID).storage();
  const outsiderStorage = environment.authenticatedContext('outsider').storage();
  await assertSucceeds(getBytes(ref(memberStorage, path)));
  await assertFails(getBytes(ref(outsiderStorage, path)));
});

test('forged metadata and oversized non-image content are rejected', async () => {
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();
  await assertFails(
    uploadBytes(
      ref(
        ownerStorage,
        `community-covers/public_cover/${OWNER_ID}/forged.jpg`
      ),
      new Uint8Array([1]),
      metadata('another_community')
    )
  );
  await assertFails(
    uploadBytes(
      ref(
        ownerStorage,
        `community-covers/public_cover/${OWNER_ID}/cover.txt`
      ),
      new Uint8Array([1]),
      {
        contentType: 'text/plain',
        customMetadata: {
          communityId: 'public_cover',
          ownerId: OWNER_ID,
        },
      }
    )
  );
});

test('owner uploads a content-addressed app image that public storefronts can read', async () => {
  const hash = 'a'.repeat(64);
  const path = `app-images/${OWNER_ID}/${hash}`;
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();

  await assertSucceeds(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1, 2, 3]),
      appImageMetadata(hash)
    )
  );
  await assertSucceeds(
    getBytes(ref(environment.unauthenticatedContext().storage(), path))
  );
  await assertSucceeds(deleteObject(ref(ownerStorage, path)));
});

test('another user cannot replace or delete an app image', async () => {
  const hash = 'b'.repeat(64);
  const path = `app-images/${OWNER_ID}/${hash}`;
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();
  const outsiderStorage = environment.authenticatedContext('outsider').storage();

  await assertSucceeds(
    uploadBytes(
      ref(ownerStorage, path),
      new Uint8Array([1]),
      appImageMetadata(hash)
    )
  );
  await assertFails(
    uploadBytes(
      ref(outsiderStorage, path),
      new Uint8Array([9]),
      appImageMetadata(hash, 'outsider')
    )
  );
  await assertFails(deleteObject(ref(outsiderStorage, path)));
});

test('app images reject a forged hash, forged owner and unsupported content', async () => {
  const hash = 'c'.repeat(64);
  const ownerStorage = environment.authenticatedContext(OWNER_ID).storage();

  await assertFails(
    uploadBytes(
      ref(ownerStorage, `app-images/${OWNER_ID}/${hash}`),
      new Uint8Array([1]),
      appImageMetadata('d'.repeat(64))
    )
  );
  await assertFails(
    uploadBytes(
      ref(ownerStorage, `app-images/${OWNER_ID}/${hash}`),
      new Uint8Array([1]),
      appImageMetadata(hash, 'forged_owner')
    )
  );
  await assertFails(
    uploadBytes(
      ref(ownerStorage, `app-images/${OWNER_ID}/${hash}`),
      new Uint8Array([1]),
      {
        contentType: 'image/gif',
        customMetadata: {
          ownerId: OWNER_ID,
          contentHash: hash,
        },
      }
    )
  );
});


const wallMediaMetadata = (communityId: string, ownerId: string, contentType: string) => ({
  contentType,
  customMetadata: { communityId, ownerId, purpose: 'community-wall' },
});

test('community creator can upload image and video and members can read media', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).storage();
  const imagePath = `community-post-media/public_cover/${OWNER_ID}/image-test.jpg`;
  const videoPath = `community-post-media/public_cover/${OWNER_ID}/video-test.mp4`;
  await assertSucceeds(uploadBytes(ref(owner, imagePath), new Uint8Array([1, 2, 3]),
    wallMediaMetadata('public_cover', OWNER_ID, 'image/jpeg')));
  await assertSucceeds(uploadBytes(ref(owner, videoPath), new Uint8Array([1, 2, 3]),
    wallMediaMetadata('public_cover', OWNER_ID, 'video/mp4')));
  const visitor = environment.authenticatedContext('visitor').storage();
  await assertSucceeds(getBytes(ref(visitor, imagePath)));
  await assertSucceeds(getBytes(ref(visitor, videoPath)));
  await assertFails(deleteObject(ref(visitor, imagePath)));
  await assertSucceeds(deleteObject(ref(owner, videoPath)));
});

test('private communities cannot issue shareable media download links', async () => {
  const member = environment.authenticatedContext(MEMBER_ID).storage();
  const mediaPath = `community-post-media/private_cover/${MEMBER_ID}/image-membership.png`;
  await assertFails(uploadBytes(ref(member, mediaPath), new Uint8Array([1]),
    wallMediaMetadata('private_cover', MEMBER_ID, 'image/png')));
  const outsider = environment.authenticatedContext('outsider').storage();
  await assertFails(getBytes(ref(outsider, mediaPath)));
  await assertFails(uploadBytes(ref(outsider, `community-post-media/private_cover/outsider/image-bypass.png`),
    new Uint8Array([1]), wallMediaMetadata('private_cover', 'outsider', 'image/png')));
  await assertFails(uploadBytes(ref(outsider, `community-post-media/public_cover/outsider/image-bypass.png`),
    new Uint8Array([1]), wallMediaMetadata('public_cover', 'outsider', 'image/png')));
});

test('community wall upload rejects forged owner, metadata, MIME and size', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).storage();
  const mediaPath = `community-post-media/public_cover/${OWNER_ID}/image-test.jpg`;
  const visitor = environment.authenticatedContext('visitor').storage();
  await assertFails(uploadBytes(ref(visitor, mediaPath), new Uint8Array([1]),
    wallMediaMetadata('public_cover', OWNER_ID, 'image/jpeg')));
  await assertFails(uploadBytes(ref(owner, mediaPath), new Uint8Array([1]),
    wallMediaMetadata('another_community', OWNER_ID, 'image/jpeg')));
  await assertFails(uploadBytes(ref(owner, mediaPath), new Uint8Array([1]),
    wallMediaMetadata('public_cover', 'forged_owner', 'image/jpeg')));
  await assertFails(uploadBytes(ref(owner, mediaPath), new Uint8Array([1]),
    wallMediaMetadata('public_cover', OWNER_ID, 'application/pdf')));
  await assertFails(uploadBytes(ref(owner, `community-post-media/public_cover/${OWNER_ID}/video-oversize.mp4`),
    new Uint8Array(20 * 1024 * 1024 + 1),
    wallMediaMetadata('public_cover', OWNER_ID, 'video/mp4')));
});


const tagMediaMetadata=(id:string,ownerId:string,purpose:'cover'|'avatar')=>({
 contentType:'image/webp',
 customMetadata:{tagId:id,ownerId,purpose}
});

test('promotional Tag media are private and owner-only, even when the card itself is public',async()=>{
 const id='e'.repeat(32),owner='tag_photo_owner';
 await environment.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),'kyrub_official_tags',id),{
   distribution:'promotional',model:'adesivo',ownerId:owner,enabled:true,blocked:false
  });
 });
 const path='kyrub-tag-media/'+id+'/cover/'+'b'.repeat(32);
 const ownerStorage=environment.authenticatedContext(owner,{email_verified:true}).storage();
 const visitor=environment.unauthenticatedContext().storage();
 const other=environment.authenticatedContext('other',{email_verified:true}).storage();
 const unverified=environment.authenticatedContext(owner,{email_verified:false}).storage();
 await assertSucceeds(uploadBytes(ref(ownerStorage,path),new Uint8Array([1,2,3]),tagMediaMetadata(id,owner,'cover')));
 await assertSucceeds(getBytes(ref(ownerStorage,path)));
 await assertFails(getBytes(ref(visitor,path)));
 await assertFails(getBytes(ref(other,path)));
 await assertFails(getBytes(ref(unverified,path)));
 await assertFails(uploadBytes(ref(other,'kyrub-tag-media/'+id+'/avatar/'+'d'.repeat(32)),
  new Uint8Array([1]),tagMediaMetadata(id,'other','avatar')));
 await assertFails(uploadBytes(ref(ownerStorage,path),new Uint8Array([9]),tagMediaMetadata(id,owner,'cover')));
 await assertFails(deleteObject(ref(ownerStorage,path)));
});

test('Tag media cannot be created under protected, blocked or forged inventory',async()=>{
 const id='f'.repeat(32),owner='tag_media_owner';
 await environment.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),'kyrub_official_tags',id),{
   distribution:'promotional',model:'adesivo',ownerId:owner,enabled:false,blocked:true
  });
  await setDoc(doc(context.firestore(),'kyrub_official_tags','a'.repeat(32)),{
   model:'adesivo',ownerId:owner,enabled:true,blocked:false
  });
 });
 const principal=environment.authenticatedContext(owner,{email_verified:true}).storage();
 const bytes=new Uint8Array([1,2,3]);
 const path='kyrub-tag-media/'+id+'/avatar/'+'1'.repeat(32);
 await assertFails(uploadBytes(ref(principal,path),bytes,tagMediaMetadata(id,owner,'avatar')));
 const protectedPath='kyrub-tag-media/'+'a'.repeat(32)+'/avatar/'+'2'.repeat(32);
 await assertFails(uploadBytes(ref(principal,protectedPath),bytes,tagMediaMetadata('a'.repeat(32),owner,'avatar')));
 const missing='kyrub-tag-media/'+'9'.repeat(32)+'/avatar/'+'3'.repeat(32);
 await assertFails(uploadBytes(ref(principal,missing),bytes,tagMediaMetadata('9'.repeat(32),owner,'avatar')));
 await environment.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),'kyrub_official_tags',id),{
   distribution:'promotional',model:'adesivo',ownerId:owner,enabled:true,blocked:false
  });
 });
 await assertFails(uploadBytes(ref(principal,path),bytes,tagMediaMetadata(id,'forged_owner','avatar')));
 await assertFails(uploadBytes(ref(principal,path),bytes,tagMediaMetadata(id,owner,'cover')));
 await assertFails(uploadBytes(ref(principal,path),bytes,{contentType:'image/png',
  customMetadata:{tagId:id,ownerId:owner,purpose:'avatar'}}));
 await assertFails(uploadBytes(ref(principal,path),new Uint8Array(1024*1024+1),tagMediaMetadata(id,owner,'avatar')));
 await assertSucceeds(uploadBytes(ref(principal,path),bytes,tagMediaMetadata(id,owner,'avatar')));
});
