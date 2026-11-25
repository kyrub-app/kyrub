// Local-only client for the separately mounted HTTP test harness.
export type SuspicionStatus='all'|'open'|'closed';
export type PilotSession={uid:string;getIdToken:()=>Promise<string>};
export type PilotQuery={operation:'snapshot'}|{operation:'cases';status:SuspicionStatus;limit:number;afterCaseId?:string}|{operation:'case';caseId:string};
export async function requestGamificationPilot(
 query:PilotQuery,session:PilotSession,isCurrent:()=>boolean,signal:AbortSignal,
):Promise<unknown>{
 if(!isCurrent()||signal.aborted)throw Error('SESSION_CHANGED');
 const token=await session.getIdToken();
 if(!isCurrent()||signal.aborted)throw Error('SESSION_CHANGED');
 const params=new URLSearchParams();
 for(const [key,value] of Object.entries(query))if(value!==undefined)params.set(key,String(value));
 const response=await fetch('/api/admin/gamification-pilot?'+params.toString(),{
  method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',redirect:'error',signal,
 });
 if(!isCurrent()||signal.aborted)throw Error('SESSION_CHANGED');
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('SUPERVISION_UNAVAILABLE');
 const result:unknown=await response.json();
 if(!isCurrent()||signal.aborted)throw Error('SESSION_CHANGED');
 return result;
}


export type PilotCaseCommand={operation:'open';caseId:string;kind:'personal'|'community';postId:string;confirmed:true}|
 {operation:'close';caseId:string;outcome:'resolved'|'inconclusive'|'referred_for_review';confirmed:true};
export async function submitGamificationPilotCase(command:PilotCaseCommand,session:PilotSession,isCurrent:()=>boolean,signal:AbortSignal):Promise<unknown>{
 if(!isCurrent()||signal.aborted)throw Error('SESSION_CHANGED');
 const token=await session.getIdToken();
 if(!isCurrent()||signal.aborted)throw Error('SESSION_CHANGED');
 const response=await fetch('/api/admin/gamification-pilot',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify(command),cache:'no-store',credentials:'omit',redirect:'error',signal,
 });
 if(!isCurrent()||signal.aborted)throw Error('SESSION_CHANGED');
 if(!response.headers.get('content-type')?.includes('application/json'))throw Error('SUPERVISION_UNAVAILABLE');
 const data=await response.json();
 if(!isCurrent()||signal.aborted)throw Error('SESSION_CHANGED');
 if(!response.ok){
  if(response.status===409&&typeof data.code==='string')throw Error(data.code);
  throw Error('SUPERVISION_UNAVAILABLE');
 }
 if(data?.caseId!==command.caseId||!['open','closed'].includes(data.status))throw Error('INVALID_PILOT_RESPONSE');
 return data;
}
