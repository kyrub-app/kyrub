import {isTagId} from '../../shared/kyrubTagContract.js';
import {assertProductionPasskeyUnit} from '../identity/kyrubTagPasskeyReleasePolicy.js';
import {isOpenPromotionalTag} from '../../shared/kyrubTagPromotional.js';
/** Never create inventory or infer NFC authenticity from the public URL.
 * The operator's previously recorded readback is required. */
export function assertSingleTagRelease(approved:string,batchId:string,tagId:string,batch:Record<string,unknown>|undefined,unit:Record<string,unknown>|undefined):'held'|'released'{
 if(!isTagId(batchId)||!isTagId(tagId)||approved!==tagId||!batch||!unit||
 batch.mode!=='promotional'||batch.model!=='adesivo'||batch.urlMode!=='permanent'||
 !Array.isArray(batch.tagIds)||!batch.tagIds.includes(tagId)||unit.promotionalBatchId!==batchId||
 !['held','released'].includes(String(unit.manufacturingState)))throw Error('TAG_BATCH_CONFLICT');
 const report=(batch.readbackReports as Record<string,Record<string,unknown>>|undefined)?.[tagId];
 if(!report||report.status!=='browser_readback_confirmed'||report.previewHost!=='kyrub.com'||report.verificationMethod!=='browser-reported-ndef-readback')throw Error('TAG_READBACK_MISMATCH');
 try{assertProductionPasskeyUnit(approved,tagId,{...unit,manufacturingState:'released'});}catch{throw Error('TAG_BATCH_CONFLICT');}
 if(unit.manufacturingState==='released')return 'released';
 if(!isOpenPromotionalTag({...unit,manufacturingState:'released'})||unit.ownerAuthMode!=null)throw Error('TAG_BATCH_CONFLICT');
 return 'held';
}
