/** Share simultaneous reads only, within the identical authenticated session.
 * No completed-response cache, no persistence, no mutation coalescing.
 * Each subscriber can cancel independently. Abort the transport when the last
 * subscriber leaves. Invalidation detaches pre-mutation requests from new reads. */
export function createSemeaduraReadCoalescer<T>(){
 type Entry={controller:AbortController;promise:Promise<T>;subscribers:number};
 const sessions=new WeakMap<object,Map<string,Entry>>();
 const mapFor=(session:object)=>{
  let map=sessions.get(session);
  if(!map){map=new Map();sessions.set(session,map);}
  return map;
 };
 const invalidate=(session:object,key:string)=>{
  sessions.get(session)?.delete(key);
 };
 const read=(session:object,key:string,load:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal):Promise<T>=>{
  if(signal?.aborted)return Promise.reject(Error('SEMEADURA_READ_ABORTED'));
  const map=mapFor(session);
  let entry=map.get(key);
  if(!entry){
   const controller=new AbortController();
   const created:Entry={controller,subscribers:0,promise:Promise.resolve().then(()=>load(controller.signal))};
   entry=created;map.set(key,created);
   const cleanup=()=>{if(map.get(key)===created)map.delete(key);};
   void created.promise.then(cleanup,cleanup);
  }
  const current=entry;current.subscribers++;
  return new Promise<T>((resolve,reject)=>{
   let done=false;
   const finish=()=>{
    if(done)return false;
    done=true;signal?.removeEventListener('abort',abort);
    current.subscribers--;
    if(current.subscribers===0){
     if(map.get(key)===current)map.delete(key);
     current.controller.abort();
    }
    return true;
   };
   const abort=()=>{if(finish())reject(Error('SEMEADURA_READ_ABORTED'));};
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted)abort();
   void current.promise.then(value=>{if(finish())resolve(value);},error=>{if(finish())reject(error);});
  });
 };
 return {read,invalidate};
}
