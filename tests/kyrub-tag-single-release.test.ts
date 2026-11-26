import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertSingleTagRelease} from '../server/admin/kyrubTagSingleReleasePolicy';
const id='a'.repeat(32),batchId='b'.repeat(32),other='c'.repeat(32);
const report={status:'browser_readback_confirmed',previewHost:'kyrub.com',verificationMethod:'browser-reported-ndef-readback'};
const batch={mode:'promotional',model:'adesivo',urlMode:'permanent',tagIds:[id,other],readbackReports:{[id]:report,[other]:report}};
const unit={model:'adesivo',distribution:'promotional',urlMode:'permanent',manufacturingState:'held',promotionalBatchId:batchId,ownerId:null,enabled:false,blocked:false,activationHash:null,reservedEmailHash:null};
test('only selected confirmed virgin permanent stock can be released, no duplicate writes',()=>{
 assert.equal(assertSingleTagRelease(id,batchId,id,batch,unit),'held');
 assert.equal(assertSingleTagRelease(id,batchId,id,batch,{...unit,manufacturingState:'released'}),'released');
 assert.throws(()=>assertSingleTagRelease(id,batchId,other,batch,unit));
 assert.throws(()=>assertSingleTagRelease(id,batchId,id,{...batch,readbackReports:{}},unit));
 assert.throws(()=>assertSingleTagRelease(id,batchId,id,{...batch,readbackReports:{[id]:{...report,previewHost:'test.vercel.app'}}},unit));
 assert.throws(()=>assertSingleTagRelease(id,batchId,id,{...batch,urlMode:'pilot'},unit));
 for(const data of [{...unit,ownerId:'someone'},{...unit,enabled:true},{...unit,activationHash:'secret'},{...unit,pilotBatch:'experimental-001'},{...unit,promotionalBatchId:other},{...unit,manufacturingState:'unknown'}])assert.throws(()=>assertSingleTagRelease(id,batchId,id,batch,data));
});
