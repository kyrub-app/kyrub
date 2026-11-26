import {adminDb} from '../firebaseAdmin.js';
import {assertTagPilotWriteIsolated} from './kyrubTagPilotIsolation.js';
import {isTagId,isTagModel} from '../../shared/kyrubTagContract.js';
import {normalizePromotionalPresentation} from '../../shared/kyrubTagPromotional.js';
export async function listLinkedPasskeyTags(actor:string){
 assertTagPilotWriteIsolated();
 if(process.env.KYRUB_TAG_PASSKEY_PILOT_ENABLED!=='true'||process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED!=='true')throw Error('TAG_PASSKEY_DISABLED');
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(actor)||actor.startsWith('tagpk_'))throw Error('TAG_FORBIDDEN');
 const [account,marker]=await Promise.all([adminDb.doc('users/'+actor).get(),adminDb.doc('kyrub_tag_minimal_identities/'+actor).get()]);
 if(!account.exists||marker.get('mode')==='tag_only')throw Error('TAG_ACCOUNT_REQUIRED');
 const records=await adminDb.collection('kyrub_official_tags').where('linkedAccountId','==',actor).limit(101).get();
 return {tags:records.docs.slice(0,100).flatMap(doc=>{
  const data=doc.data();
  if(data.linkedAccountId!==actor||data.ownerAuthMode!=='passkey'||data.distribution!=='promotional'||!isTagId(doc.id)||!isTagModel(data.model))return [];
  const presentation=normalizePromotionalPresentation(data.presentation);
  return [{id:doc.id,model:data.model,enabled:data.enabled===true,blocked:data.blocked===true,presentation:{name:presentation.name,occupation:presentation.occupation,about:presentation.about}}];
 }),hasMore:records.size>100};
}
