import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {optimizeCommunityWallImage,type WallJpegCodec} from '../src/utils/communityWallImageOptimization';

function jpeg(width:number,height:number){
 const bytes=new Uint8Array(400*1024);
 bytes.set([255,216,255,192,0,11,8,height>>8,height&255,width>>8,width&255,1,1,17,0]);
 return new Blob([bytes],{type:'image/jpeg'});
}

test('large public JPEGs shrink without upscaling; unsafe, unsupported and low-gain sources retain bytes',async()=>{
 let closed=0;
 let target:unknown;
 const compressed=new Blob([new Uint8Array(100*1024)],{type:'image/jpeg'});
 const codec:WallJpegCodec={
  decode:async()=>({width:4000,height:3000,close:()=>{closed++;}}),
  encode:async(_image,size)=>{target=size;return compressed;}
 };
 const source=jpeg(4000,3000);
 assert.equal(await optimizeCommunityWallImage(source,codec),compressed);
 assert.deepEqual(target,{width:1800,height:1350});
 assert.equal(closed,1);
 for(const file of [jpeg(8000,8000),new Blob([new Uint8Array(400*1024)],{type:'image/png'}),new Blob([new Uint8Array(400*1024)],{type:'image/webp'}),new Blob([new Uint8Array(400*1024)],{type:'image/jpeg'})]){
  assert.equal(await optimizeCommunityWallImage(file,codec),file);
 }
 assert.equal(await optimizeCommunityWallImage(source,{...codec,encode:async()=>source}),source);
 assert.equal(await optimizeCommunityWallImage(source,{...codec,decode:async()=>{throw Error('unsupported');}}),source);
});

test('shared public image uploader hashes stored bytes, reuses only concurrent same-owner uploads and returns actual stored metadata',()=>{
 const source=readFileSync('src/utils/appImageStorage.ts','utf8');
 assert.match(source,/await optimizeCommunityWallImage\(file\)/);
 assert.match(source,/await contentHash\(payload\)/);
 assert.match(source,/pendingUploads\.get\(path\)/);
 assert.match(source,/uploadBytes\(imageReference, payload/);
 assert.match(source,/sizeBytes: payload\.size/);
 assert.match(source,/auth\.currentUser\?\.uid!==user\.uid/);
 assert.match(source,/pendingUploads\.delete\(path\)/);
});
