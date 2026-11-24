import type {ReactNode} from 'react';
import {ChevronRight,Store,UserRound,Users} from 'lucide-react';
import {buildPublicDestinationPath,parsePublicDestinationUrl} from '../../shared/publicDestinationRoutes';

type PresentationLink={name:string;url:string;kind?:string};
type Props={name:string;occupation?:string;bio?:string;photoUrl?:string;coverUrl?:string;backgroundUrl?:string;links:PresentationLink[];children?:ReactNode;headingLevel?:'h1'|'h3'};

/** Visual presentation only. No chat, authentication, device or emergency logic. */
export function PresentationCard({name,occupation,bio,photoUrl,coverUrl,backgroundUrl,links,children,headingLevel='h3'}:Props){
 const Heading=headingLevel;
 const destinations=links.flatMap(link=>{
  const target=parsePublicDestinationUrl(link.url);
  if(!target||(target.kind!=='community'&&target.kind!=='store'))return [];
  const path=buildPublicDestinationPath(target.kind,target.identifier);
  return path?[{name:link.name,path,kind:target.kind}]:[];
 });
 return <section className="relative isolate overflow-hidden rounded-2xl border border-[#34443B] bg-[#121A17] p-4 text-[#F5F5F3]">
  {backgroundUrl&&<img src={backgroundUrl} alt="" aria-hidden="true" referrerPolicy="no-referrer" className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-20"/>}
  <div className="space-y-4">
   {coverUrl&&<img src={coverUrl} alt="Capa da apresentação" referrerPolicy="no-referrer" className="h-36 w-full rounded-xl object-cover"/>}
   <div className={'relative flex flex-col items-center text-center '+(coverUrl?'-mt-12':'')}>
    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-[3px] border-[#F47825] bg-[#26352D]">
     {photoUrl?<img src={photoUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover"/>:<UserRound aria-hidden="true" className="h-12 w-12 text-slate-300"/>}
    </div>
    <Heading className="mt-3 max-w-full break-words text-xl font-bold">{name}</Heading>
    {occupation&&<p className="mt-1 break-words text-sm font-medium text-[#F47825]">{occupation}</p>}
   </div>
   {bio&&<p className="whitespace-pre-wrap break-words text-center text-sm leading-relaxed text-slate-200">{bio}</p>}
   {(['community','store'] as const).map(kind=>{
    const entries=destinations.filter(link=>link.kind===kind);
    return entries.length>0&&<section key={kind} className="space-y-2">
     <h4 className="text-sm font-semibold">{kind==='community'?'Comunidades':'Lojas e vitrines'}</h4>
     {entries.map(link=><a key={link.path} href={link.path} className="flex min-h-12 items-center gap-3 rounded-xl border border-[#34443B] bg-[#1D2924] p-3 text-sm">
      {kind==='community'?<Users className="h-5 w-5 shrink-0 text-[#F47825]"/>:<Store className="h-5 w-5 shrink-0 text-[#F47825]"/>}
      <span className="min-w-0 flex-1 break-words">{link.name}</span><ChevronRight className="h-4 w-4 shrink-0"/>
     </a>)}
    </section>;
   })}
   {children}
  </div>
 </section>;
}
