import {useEffect,useRef,useState,type FormEvent} from 'react';
import {splitTribeSearchInput} from '../utils/tribeContactSearch';
import {Search,X} from 'lucide-react';

type Props={term:string;onSearch:(term:string)=>void;unlockAvailable:boolean;ownerScope:string;onUnlock:(code:string,signal:AbortSignal)=>Promise<boolean>};
/** Ready for integration only after migration of the protected directory.
 * No token persistence, autocomplete, URL parameter, analytics or automatic
 * network request. Parent owns the ephemeral unlocked session and its expiry.
 */
export function ReservedTribeSearchInput({term,onSearch,unlockAvailable,ownerScope,onUnlock}:Props){
 const [secretMode,setSecretMode]=useState(false),[busy,setBusy]=useState(false);
 const [secret,setSecret]=useState('');
 const attempt=useRef<AbortController|null>(null);
 const reset=()=>{attempt.current?.abort();attempt.current=null;setSecret('');setSecretMode(false);setBusy(false);};
 useEffect(()=>{reset();return()=>attempt.current?.abort();},[ownerScope,unlockAvailable]);
 const change=(value:string)=>{
  if(secretMode){setSecret(value.slice(0,64));return;}
  const input=splitTribeSearchInput(value,unlockAvailable);
  if(input.kind==='unlock'){onSearch('');setSecretMode(true);setSecret(input.code.slice(0,64));}
  else onSearch(input.term);
 };
 async function submit(event:FormEvent){
  event.preventDefault();
  if(!secretMode||busy||!unlockAvailable)return;
  const code=secret;
  setSecret('');
  const controller=new AbortController();attempt.current=controller;setBusy(true);
  try{await onUnlock(code,controller.signal);}
  catch{/* No code or transport errors exposed in the ordinary search. */}
  finally{if(attempt.current===controller){attempt.current=null;setBusy(false);setSecretMode(false);}}
 }
 return <form className="relative" onSubmit={submit} autoComplete="off">
  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
  <input type={secretMode?'password':'search'} aria-label="Pesquisar pessoas em Conectados"
   value={secretMode?secret:term} onChange={event=>change(event.target.value)}
   placeholder="Pesquisar conectados..." autoComplete={secretMode?'new-password':'off'}
   autoCapitalize="none" spellCheck={false} disabled={busy}
   onBlur={()=>{if(!busy&&secretMode)reset();}} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();reset();onSearch('');}}}
   className="min-h-11 w-full rounded-2xl border border-slate-800 bg-slate-900 py-3 pl-10 pr-12 text-sm text-white outline-none focus:border-orange-500"/>
  {(term||secretMode)&&<button type="button" aria-label="Limpar pesquisa" onMouseDown={event=>event.preventDefault()} onClick={()=>{reset();onSearch('');}} className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-slate-400"><X aria-hidden="true" className="h-4 w-4"/></button>}
  <button type="submit" className="sr-only" tabIndex={-1}>Pesquisar</button>
 </form>;
}
