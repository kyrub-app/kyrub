import {useEffect,useState} from 'react';
import {PresentationCard} from './PresentationCard';
import {PresentationShare} from './PresentationShare';
import {PresentationFooter,usePresentationMembership} from './PresentationFooter';
type Data={kind:'profile'|'community';identifier:string;name:string;description:string;image:string;presentation?:{name:string;occupation:string;bio:string;photoUrl:string;coverUrl:string;backgroundUrl:string;links:{name:string;url:string}[]}};
export function PublicSocialDestinationPage({kind,identifier}:{kind?:'profile'|'community';identifier?:string}) {
  const membership=usePresentationMembership();
  const [data,setData]=useState<Data|null>(null);
  const [state,setState]=useState<'loading'|'missing'|'error'|'ready'>('loading');
  useEffect(()=>{
    const ctrl=new AbortController();
    setData(null);
    if(!kind||!identifier){setState('missing');return ()=>ctrl.abort();}
    setState('loading');
    void fetch('/api/public-social/'+kind+'/'+encodeURIComponent(identifier),{cache:'no-store',signal:ctrl.signal}).then(async res=>{
      if(ctrl.signal.aborted)return;
      if(res.status===404){setState('missing');return;}
      if(!res.ok)throw Error('UNAVAILABLE');
      const value=await res.json() as Data;
      if(ctrl.signal.aborted)return;
      if(value.kind!==kind||value.identifier!==identifier||typeof value.name!=='string')throw Error('INVALID');
      setData(value);setState('ready');
    }).catch(()=>{if(!ctrl.signal.aborted)setState('error');});
    return ()=>ctrl.abort();
  },[kind,identifier]);
  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
    <div className="mx-auto max-w-md space-y-4">
      <a href="/" className="flex items-center gap-2 text-lg font-black text-orange-400"><img src="/kyrub-logo.svg" alt="" className="h-10 w-10"/>Kyrub</a>
      {state==='ready'&&data?(data.kind==='profile'&&data.presentation?<PresentationCard {...data.presentation} headingLevel="h1">
        <p className="text-center text-sm text-slate-300">@{data.identifier}</p>
        <PresentationShare url={window.location.origin+'/kairubido/'+encodeURIComponent(data.identifier)} title={data.presentation.name}/>
      </PresentationCard>:<article className="space-y-3 rounded-3xl border border-slate-700 bg-slate-900 p-5">
        <p className="text-xs font-bold uppercase text-slate-400">{data.kind==='profile'?'Kairubido':'Comunidade'}</p>
        {data.image&&<img src={data.image} alt="" referrerPolicy="no-referrer" className={data.kind==='profile'?'h-24 w-24 rounded-full object-cover':'h-40 w-full rounded-xl object-cover'}/>}
        <h1 className="break-words text-2xl font-black">{data.name}</h1>
        <p className="text-sm text-orange-300">{data.identifier}</p>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{data.description}</p>
      </article>):<p role="status" className="rounded-xl bg-slate-900 p-4">{state==='loading'?'Consultando endereço…':state==='missing'?'Este endereço não está disponível.':'Não foi possível carregar o endereço. Tente atualizar a página.'}</p>}
      {state==='ready'&&data?.kind==='profile'&&data.presentation?<PresentationFooter mode={membership}/>:<a href="/" className="block rounded-xl bg-orange-500 p-3 text-center font-bold text-slate-950">Explorar Kyrub</a>}
    </div>
  </main>;
}
