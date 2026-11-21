import {useEffect,useState} from 'react';
import {KYRUB_TAG_MODEL_LABELS,isTagModel,type KyrubTagModel} from '../../shared/kyrubTagContract';
import {parsePublicDestinationUrl,buildPublicDestinationPath} from '../../shared/publicDestinationRoutes';
type Payload={id:string;model:KyrubTagModel;status:'unclaimed'|'active';links:{name:string;url:string}[]};
export function PublicKyrubTagPage({identifier}:{identifier:string}){
 const [data,setData]=useState<Payload|null>(null),[error,setError]=useState('');
 useEffect(()=>{const ctrl=new AbortController();setData(null);setError('');
 void fetch('/api/health?transport=public-kyrub-tag&id='+encodeURIComponent(identifier),{cache:'no-store',signal:ctrl.signal}).then(async res=>{
 if(!res.ok)throw Error(res.status===404?'Dispositivo indisponível.':'Não foi possível consultar o dispositivo.');
 const value=await res.json() as Payload;
 if(value.id!==identifier||!isTagModel(value.model)||!Array.isArray(value.links)||!['unclaimed','active'].includes(value.status))throw Error('Dispositivo indisponível.');
 if(!ctrl.signal.aborted)setData(value);
 }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Dispositivo indisponível.');});return()=>ctrl.abort();},[identifier]);
 return <main className="min-h-screen bg-slate-950 p-4 text-slate-100"><div className="mx-auto max-w-md space-y-4 py-8">
 <a href="/" className="font-black text-orange-300">KYRUB</a><h1 className="text-2xl font-black">Kyrub Tag</h1>
 {error?<p role="status">{error}</p>:!data?<p role="status">Consultando dispositivo…</p>:<>
 <p>{KYRUB_TAG_MODEL_LABELS[data.model]}</p>
 {data.status==='unclaimed'?<div className="space-y-3 rounded-xl bg-slate-900 p-4"><strong>Disponível para vinculação</strong><p>Entre no Kyrub, abra Meu perfil → Dispositivos → Kyrub Tag oficial e informe este identificador e o código de ativação entregue separadamente.</p><code className="block break-all">{identifier}</code></div>:data.links.length===0?<p>Nenhum destino público disponível.</p>:data.links.map(l=>{const p=typeof l?.url==='string'?parsePublicDestinationUrl(l.url):null;if(!p||p.kind==='card'||typeof l.name!=='string')return null;return <a key={l.url} href={buildPublicDestinationPath(p.kind,p.identifier)??'/'} className="block rounded-xl border border-slate-700 bg-slate-900 p-4">{l.name}</a>;})}
 <p className="text-xs text-slate-400">Registro no Kyrub não comprova autenticidade criptográfica do chip físico.</p></>}
 <a href="/" className="block rounded-xl bg-orange-500 p-3 text-center font-bold text-slate-950">Acessar Kyrub</a>
 </div></main>;
}
