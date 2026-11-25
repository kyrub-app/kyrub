import type { SemeaduraPostKind } from '../../shared/pitangueiraJourney';
type Target={kind:SemeaduraPostKind;postId:string};
type Row={kind:SemeaduraPostKind;postId:string;status:Record<string,unknown>|null};
type Pending={target:Target;resolve:(value:Record<string,unknown>)=>void;reject:(reason:unknown)=>void;signal:AbortSignal};
const key=(t:Target)=>JSON.stringify([t.kind,t.postId]);

/** Short, session-scoped collection window; no response caching.
 * Duplicate targets after invalidation start another batch. */
export function createSemeaduraStatusBatcher(){
 type Queue={items:Pending[];timer:ReturnType<typeof setTimeout>};
 const queues=new WeakMap<object,Queue>();
 const flush=(session:object,queue:Queue,load:(targets:Target[])=>Promise<unknown>)=>{
  if(queues.get(session)!==queue)return;
  queues.delete(session);clearTimeout(queue.timer);
  const active=queue.items.filter(item=>!item.signal.aborted);
  for(const item of queue.items)if(item.signal.aborted)item.reject(Error('SEMEADURA_READ_ABORTED'));
  if(!active.length)return;
  void Promise.resolve().then(()=>load(active.map(item=>item.target))).then(raw=>{
   if(!raw||typeof raw!=='object'||!Array.isArray((raw as {results?:unknown}).results))throw Error('SEMEADURA_BATCH_INVALID');
   const rows=(raw as {results:Row[]}).results;
   const expected=new Set(active.map(item=>key(item.target)));
   if(rows.length!==active.length||rows.some(row=>!row||!expected.has(key(row)))||
     new Set(rows.map(key)).size!==rows.length)throw Error('SEMEADURA_BATCH_INVALID');
   for(const item of active){
    const row=rows.find(row=>key(row)===key(item.target));
    if(item.signal.aborted||!row?.status||typeof row.status!=='object'||Array.isArray(row.status))item.reject(Error('SEMEADURA_STATUS_UNAVAILABLE'));
    else item.resolve(row.status);
   }
  }).catch(error=>{for(const item of active)item.reject(error);});
 };
 return (session:object,target:Target,signal:AbortSignal,load:(targets:Target[])=>Promise<unknown>)=>new Promise<Record<string,unknown>>((resolve,reject)=>{
  if(signal.aborted){reject(Error('SEMEADURA_READ_ABORTED'));return;}
  let queue=queues.get(session);
  if(queue?.items.some(item=>key(item.target)===key(target))){flush(session,queue,load);queue=undefined;}
  if(!queue){
   const created:Queue={items:[],timer:setTimeout(()=>flush(session,created,load),12)};
   queue=created;queues.set(session,queue);
  }
  queue.items.push({target,signal,resolve,reject});
  if(queue.items.length===10)flush(session,queue,load);
 });
}
