import type {User} from 'firebase/auth';
import type {CidEvidenceReviewAdapter,CidReviewDetail,CidReviewInput,CidReviewQueueItem,CidReviewDisposition} from '../../shared/cidEvidenceReview';
const origin='https://kyrub-cid-emulator.vercel.app';
export function createAdminCidEvidenceReviewPilot(user:Pick<User,'uid'|'getIdToken'>,currentUid:()=>string|null):CidEvidenceReviewAdapter{
 async function post<T>(action:string,input:unknown):Promise<T>{
  if(window.location.origin!==origin||currentUid()!==user.uid)throw Error('CID_REVIEW_DENIED');
  const token=await user.getIdToken();
  if(currentUid()!==user.uid)throw Error('CID_REVIEW_DENIED');
  const result=await fetch('/cid-homologation/api/admin-review/'+action,{method:'POST',mode:'same-origin',credentials:'omit',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json','X-Cid-Homologation':'1',Authorization:'Bearer '+token},body:JSON.stringify(input)});
  if(!result.ok||currentUid()!==user.uid)throw Error('CID_REVIEW_DENIED');
  return await result.json() as T;
 }
 return {list:()=>post<{items:CidReviewQueueItem[];hasMore:boolean}>('list',{}),detail:id=>post<CidReviewDetail>('detail',{id}),decide:(input:CidReviewInput)=>post<{revision:number;status:CidReviewDisposition}>('decide',input)};
}
