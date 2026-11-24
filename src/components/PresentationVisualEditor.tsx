import {Camera,ImagePlus,Pencil,Trash2} from 'lucide-react';
import {PresentationCard} from './PresentationCard';
import type {ReactNode} from 'react';
export type PresentationImageSlot='cover'|'avatar'|'background';
type TextField='name'|'occupation'|'bio';
type Props={name:string;occupation:string;bio:string;photoUrl:string;coverUrl:string;backgroundUrl:string;disabled:boolean;maxBio:number;requireName?:boolean;images?:boolean;onText:(field:TextField,value:string)=>void;onImage?:(slot:PresentationImageSlot,file:File)=>void;onRemove?:(slot:PresentationImageSlot)=>void;children?:ReactNode;links?:{name:string;url:string}[]};
const labels={cover:'Capa',avatar:'Foto de perfil',background:'Fundo'};
export function PresentationVisualEditor({name,occupation,bio,photoUrl,coverUrl,backgroundUrl,disabled,maxBio,requireName=false,images=true,onText,onImage,onRemove,children,links=[]}:Props){
 const action='inline-flex min-h-11 items-center gap-1 rounded-lg border border-[#34443B] bg-[#121A17]/95 px-2 text-xs text-white disabled:opacity-50';
 const imageControl=(slot:PresentationImageSlot,url:string)=><div className="flex flex-wrap justify-center gap-1">
  <label className={action+' cursor-pointer'}>{slot==='avatar'?<Camera aria-hidden="true" className="h-4 w-4"/>:<ImagePlus aria-hidden="true" className="h-4 w-4"/>}{url?'Alterar':'Adicionar'} {labels[slot].toLowerCase()}
   <input type="file" aria-label={'Alterar '+labels[slot]} accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={disabled} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)onImage?.(slot,file);}}/>
  </label>
  {url&&<button type="button" aria-label={'Remover '+labels[slot]} disabled={disabled} className={action} onClick={()=>onRemove?.(slot)}><Trash2 aria-hidden="true" className="h-4 w-4"/></button>}
 </div>;
 const field='w-full min-h-11 rounded-lg border border-[#34443B] bg-[#121A17]/90 p-2 text-center text-white disabled:opacity-50';
 return <PresentationCard name={name} occupation={occupation} bio={bio} photoUrl={photoUrl} coverUrl={coverUrl} backgroundUrl={backgroundUrl} links={links} editor={{
  ...(images?{cover:imageControl('cover',coverUrl),avatar:imageControl('avatar',photoUrl),background:imageControl('background',backgroundUrl)}:{}),
  name:<label className="mt-3 block w-full"><span className="flex items-center justify-center gap-1 text-xs text-slate-300"><Pencil className="h-3 w-3"/>Nome de exibição</span><input className={field+' font-bold text-lg'} value={name} required={requireName} maxLength={80} placeholder="Como deseja ser chamado?" disabled={disabled} onChange={e=>onText('name',e.target.value)}/></label>,
  occupation:<label className="mt-2 block w-full"><span className="text-xs text-slate-300">O que você faz?</span><input className={field+' text-sm'} value={occupation} maxLength={90} placeholder="Sua atividade" disabled={disabled} onChange={e=>onText('occupation',e.target.value)}/></label>,
  bio:<label className="block"><span className="text-xs text-slate-300">Biografia</span><textarea className={field+' text-sm'} rows={3} maxLength={maxBio} value={bio} placeholder="Uma breve apresentação" disabled={disabled} onChange={e=>onText('bio',e.target.value)}/><span className="block text-right text-xs text-slate-400">{bio.length}/{maxBio}</span></label>,
 }}>{children}</PresentationCard>;
}
