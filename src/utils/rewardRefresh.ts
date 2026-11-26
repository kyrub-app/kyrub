/** Local refresh hints only. No reward amounts, grants, storage or polling.
 * Identity is the exact initiating Auth session object, not just a UID.
 * Returning to the app revalidates remote activity at most once per 30s
 * per mounted consumer; explicit successful local operations bypass throttle. */
export type RewardRefreshReason='conversion'|'publication'|'profile_completion'|'return';
type LocalReason=Exclude<RewardRefreshReason,'return'>;
const eventName='kyrub-reward-refresh';
const generations=new WeakMap<object,number>();
export const rewardRefreshGeneration=(session:object)=>generations.get(session)??0;
export function notifyRewardRefresh(session:object,reason:LocalReason){
 generations.set(session,rewardRefreshGeneration(session)+1);
 if(typeof window!=='undefined')window.dispatchEvent(new window.CustomEvent(eventName,{detail:{session,reason}}));
}
export function subscribeRewardRefresh(session:object,isCurrent:()=>boolean,onRefresh:(reason:RewardRefreshReason)=>void){
 let lastReturn=Date.now();
 const onReturn=()=>{
  if(!isCurrent()||window.document.visibilityState==='hidden')return;
  const now=Date.now();
  if(now-lastReturn<30000)return;
  lastReturn=now;onRefresh('return');
 };
 const onLocal=(event:Event)=>{
  const detail=(event as CustomEvent<{session?:object;reason?:LocalReason}>).detail;
  if(isCurrent()&&detail?.session===session&&(detail.reason==='conversion'||detail.reason==='publication'||detail.reason==='profile_completion'))onRefresh(detail.reason);
 };
 window.addEventListener(eventName,onLocal);
 window.addEventListener('focus',onReturn);
 window.document.addEventListener('visibilitychange',onReturn);
 return ()=>{
  window.removeEventListener(eventName,onLocal);
  window.removeEventListener('focus',onReturn);
  window.document.removeEventListener('visibilitychange',onReturn);
 };
}
