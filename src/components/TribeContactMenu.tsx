import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {EllipsisVertical,Star,FolderPlus,Trash2,UserMinus,Flag,ChevronLeft} from 'lucide-react';
import type {Friend} from '../types';
type Group={id:string;name:string;memberIds:string[]};
type Props={friend:Friend;groups:Group[];favoriteReady:boolean;onFavorite:()=>void;onGroup:(id:string)=>Promise<void>;onClear:()=>void;onRemove:()=>void;onReport:()=>void};
export function TribeContactMenu({friend,groups,favoriteReady,onFavorite,onGroup,onClear,onRemove,onReport}:Props){
 const anchor=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<{left:number;top:number;maxHeight:number}|null>(null);
 const [groupMode,setGroupMode]=useState(false),[busy,setBusy]=useState(false);
 const close=()=>{setPosition(null);setGroupMode(false);};
 function show(){
  if(position){close();return;}
  const rect=anchor.current?.getBoundingClientRect();if(!rect)return;
  const width=Math.min(240,window.innerWidth-16),height=Math.min(350,window.innerHeight-16);
  const top=Math.max(8,Math.min(rect.bottom+4,window.innerHeight-height-8));
  setPosition({left:Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8)),top,maxHeight:Math.min(350,window.innerHeight-top-8)});
 }
 useEffect(()=>{
  if(!position)return;
  const dismiss=(event:Event)=>{if(event.target instanceof Node&&panel.current?.contains(event.target))return;close();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();anchor.current?.focus();}};
  panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  window.addEventListener('resize',dismiss);window.addEventListener('scroll',dismiss,true);window.addEventListener('keydown',escape,true);
  return()=>{window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',dismiss,true);window.removeEventListener('keydown',escape,true);};
 },[position]);
 const row='flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-50';
 function act(action:()=>void){close();action();}
 return <>
  <button ref={anchor} type="button" onClick={show} aria-expanded={!!position} aria-label={`Mais opções para ${friend.name}`} className="flex h-10 w-[42px] items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-white"><EllipsisVertical className="h-4 w-4"/></button>
  {position&&createPortal(<div className="fixed inset-0 z-[195]" onClick={close}>
   <div ref={panel} role="group" aria-label={`Opções de ${friend.name}`} onClick={event=>event.stopPropagation()} style={position} className="fixed w-[240px] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-xl border border-slate-700 bg-slate-950 p-1 shadow-2xl">
    {!groupMode?<><button type="button" disabled={!favoriteReady} className={row} onClick={()=>act(onFavorite)}><Star className={'h-4 w-4 text-amber-300 '+(friend.favorited?'fill-current':'')}/>{friend.favorited?'Remover dos favoritos':'Favoritar contato'}</button>
     <button type="button" className={row} onClick={()=>setGroupMode(true)}><FolderPlus className="h-4 w-4 text-violet-300"/>Adicionar a tribos</button>
     <button type="button" disabled={!friend.connectionId} className={row} onClick={()=>act(onClear)}><Trash2 className="h-4 w-4"/>Excluir conversa</button>
     <button type="button" className={row+' text-rose-300'} onClick={()=>act(onRemove)}><UserMinus className="h-4 w-4"/>Remover conexão</button>
     <button type="button" className={row+' text-amber-300'} onClick={()=>act(onReport)}><Flag className="h-4 w-4"/>Denunciar</button></>:<>
     <button type="button" className={row} onClick={()=>setGroupMode(false)}><ChevronLeft className="h-4 w-4"/>Voltar</button>
     {groups.length===0?<p className="p-3 text-xs text-slate-400">Crie uma tribo na guia Tribos.</p>:groups.map(group=><button key={group.id} type="button" role="checkbox" aria-checked={group.memberIds.includes(friend.id)} disabled={busy} className={row} onClick={async()=>{setBusy(true);try{await onGroup(group.id);}finally{setBusy(false);}}}><span className="w-4 text-violet-300">{group.memberIds.includes(friend.id)?'✓':'□'}</span><span className="min-w-0 break-words">{group.name}</span></button>)}
    </>}
   </div>
  </div>,document.body)}
 </>;
}
