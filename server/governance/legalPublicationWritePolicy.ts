import {createHash} from 'node:crypto';
import type {GovernanceDocument} from '../../shared/governance.js';

export const isIngressLegalType=(type:unknown)=>type==='terms'||type==='privacy';

/** The generic repository can maintain drafts, but has no approval authority.
 * Published, approved, reviewed or superseded ingress records must never be
 * overwritten through it, including by changing the document type. */
export function assertLegalDraftWrite(input:GovernanceDocument&{content?:unknown},prior:Record<string,unknown>|undefined):void{
 if(!isIngressLegalType(input.type)&&!isIngressLegalType(prior?.type))return;
 if(prior&&(prior.type!==input.type||prior.id!==input.id||prior.status!=='draft'||prior.version!==input.version||prior.ownerUserId!==input.ownerUserId||prior.createdAt!==input.createdAt))throw Error('LEGAL_DOCUMENT_IMMUTABLE');
 if(input.status!=='draft'||input.approvedAt!==undefined||input.publishedAt!==undefined||input.supersededAt!==undefined)throw Error('LEGAL_PUBLICATION_AUTHORITY_REQUIRED');
 if(typeof input.content!=='string'||!input.content.trim()||createHash('sha256').update(input.content,'utf8').digest('hex')!==input.hash)throw Error('LEGAL_DOCUMENT_INTEGRITY_INVALID');
}
