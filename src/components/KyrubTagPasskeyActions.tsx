import {useRef,useState} from 'react';
import {Fingerprint} from 'lucide-react';
import {runKyrubTagPasskey,supportsKyrubTagPasskey,type TagPasskeyAction} from '../utils/kyrubTagPasskeyClient';
import {buildPublicDestinationUrl,parsePublicDestinationUrl} from '../../shared/publicDestinationRoutes';
import type {PromotionalTagPresentation} from '../../shared/kyrubTagPromotional';

const button='min-h-11 rounded-xl border border-[#34443B] p-3 text-sm font-semibold disabled:opacity-50';
const orange=button+' bg-[#F47825] text-[#121A17] w-full';
export function KyrubTagPasskeyActions({tagId,mode,origin,getDraft,initial,links=[]}:{tagId:string;mode:'register'|'active'|'blocked';origin?:string;getDraft?:()=>PromotionalTagPresentation;initial?:PromotionalTagPresentation;links?:{url:string}[]}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[recovery,setRecovery]=useState(''),[editing,setEditing]=useState(false);
 const [recovering,setRecovering]=useState(false),[secret,setSecret]=useState('');
 const [draft,setDraft]=useState(initial??{name:'',occupation:'',about:''});
 const [destinations,setDestinations]=useState(()=>Object.fromEntries(links.flatMap(l=>{const p=parsePublicDestinationUrl(l.url);return p&&p.kind!=='card'?[[p.kind,p.identifier]]:[];})) as Partial<Record<'profile'|'store'|'community',string>>);
 const lock=useRef(false);
 const available=!!origin&&origin===window.location.origin&&supportsKyrubTagPasskey();
 function refresh(){window.location.reload();}
 async function execute(purpose:TagPasskeyAction,presentation?:PromotionalTagPresentation,recoverySecret?:string){
  if(lock.current||!available)return;
  if((purpose==='register'||purpose==='edit')&&!presentation?.name.trim()){setNotice('Preencha seu nome de apresentação antes de publicar.');return;}
  lock.current=true;setBusy(true);setNotice('');
  try{
   const result=await runKyrubTagPasskey(tagId,purpose,presentation,recoverySecret);
   if(purpose==='recover'){setSecret('');setRecovering(false);}
   if(purpose==='register'){try{sessionStorage.removeItem('kyrub.tag.draft.'+tagId);sessionStorage.removeItem('kyrub.card.demo.tag.'+tagId);}catch{}}
   if(result.recoveryCode){setRecovery(result.recoveryCode);setNotice('Operação concluída. Guarde o código de recuperação em local seguro.');}
   else refresh();
  }catch(e){const code=e instanceof Error?e.message:'';
   setNotice(code==='TAG_PASSKEY_RATE_LIMIT'?'Muitas tentativas. Aguarde um minuto.':code==='CARD_TARGET_UNAVAILABLE'?'Um dos destinos não está disponível. Confira os links.':code==='TAG_CHANGED'?'A unidade foi alterada. Atualize a página e tente novamente.':purpose==='recover'?'Não foi possível recuperar. Confira o código secreto e tente novamente.':'Não foi possível confirmar a operação. Use a chave de acesso autorizada e tente novamente.');
  }finally{setBusy(false);lock.current=false;}
 }
 if(recovery)return <section className="space-y-3 rounded-xl border border-amber-500/60 p-3" role="status">
  <strong>Guarde seu código de recuperação</strong>
  <p className="text-sm text-slate-300">Exibido apenas agora. Não compartilhe nem grave na NFC. Ele permite substituir uma chave de acesso perdida. Quem tiver este código poderá recuperar o gerenciamento.</p>
  <code className="block select-all break-all rounded-lg bg-[#1D2924] p-3 text-sm">{recovery}</code>
  <button type="button" className={button} onClick={()=>void navigator.clipboard.writeText(recovery).then(()=>setNotice('Código copiado.')).catch(()=>setNotice('Selecione e copie manualmente.'))}>Copiar código</button>
  <button type="button" className={orange} onClick={refresh}>Já guardei · Continuar</button>
  {notice&&<p className="text-sm">{notice}</p>}
 </section>;
 if(!available)return <p className="text-sm text-slate-300" role="status">{origin&&origin!==window.location.origin?'A chave de acesso está disponível apenas no endereço fixo de homologação.':'A chave de acesso não está disponível neste ambiente ou navegador.'}</p>;
 return <section className="space-y-3 rounded-xl border border-[#34443B] p-3" aria-label="Gerenciamento por chave de acesso">
  {mode==='register'?<>
   <p className="text-sm text-slate-300">Confirme pelo desbloqueio do seu dispositivo. O cartão será público nesta unidade, sem e-mail obrigatório. Nenhuma biometria será enviada ao Kyrub.</p>
   <button type="button" className={orange+' flex items-center justify-center gap-2'} disabled={busy} onClick={()=>void execute('register',getDraft?.())}><Fingerprint className="h-5 w-5"/>{busy?'Confirmando…':'Salvar e publicar com chave de acesso'}</button>
  </>:<>
   {mode==='active'&&<button type="button" className={button+' w-full'} disabled={busy} onClick={()=>setEditing(v=>!v)}>✎ Editar meu cartão</button>}
   {mode==='active'&&editing&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();const urls:string[]=[];for(const kind of ['profile','store','community'] as const){const value=(destinations[kind]??'').trim().replace(/^@/,'').toLowerCase();if(!value)continue;const url=buildPublicDestinationUrl(kind,value);if(!url){setNotice('Confira os identificadores.');return;}urls.push(url);}void execute('edit',{...draft,destinations:urls});}}>
    <label className="block text-sm">Nome<input required maxLength={80} value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} className="mt-1 w-full rounded-lg bg-[#1D2924] p-3"/></label>
    <label className="block text-sm">Atividade<input maxLength={90} value={draft.occupation} onChange={e=>setDraft(d=>({...d,occupation:e.target.value}))} className="mt-1 w-full rounded-lg bg-[#1D2924] p-3"/></label>
    <label className="block text-sm">Informações adicionais<textarea maxLength={320} value={draft.about} onChange={e=>setDraft(d=>({...d,about:e.target.value}))} className="mt-1 w-full rounded-lg bg-[#1D2924] p-3"/></label>
    {(['profile','store','community'] as const).map(kind=><label key={kind} className="block text-sm">{kind==='profile'?'Meu perfil':kind==='store'?'Loja':'Comunidade'}<input maxLength={120} value={destinations[kind]??''} onChange={e=>setDestinations(d=>({...d,[kind]:e.target.value}))} className="mt-1 w-full rounded-lg bg-[#1D2924] p-3"/></label>)}
    <button type="submit" className={orange} disabled={busy}>Confirmar alterações com chave de acesso</button>
   </form>}
   <button type="button" disabled={busy} className={button+' w-full'} onClick={()=>{if(window.confirm(mode==='blocked'?'Republicar seu cartão?':'Bloquear a publicação deste cartão?'))void execute(mode==='blocked'?'unblock':'block');}}>{mode==='blocked'?'Desbloquear minha tag':'Bloquear tag perdida'}</button>
   <button type="button" disabled={busy} className={button+' w-full'} onClick={()=>{if(window.confirm('Gerar novo código e invalidar o anterior?'))void execute('rotate-recovery');}}>Gerar novo código de recuperação</button>
   <button type="button" disabled={busy} className={button+' w-full'} onClick={()=>{setRecovering(v=>!v);setSecret('');}}>Perdi minha chave de acesso</button>
   {recovering&&<form className="space-y-3 border-t border-[#34443B] pt-3" onSubmit={e=>{e.preventDefault();if(/^[A-Za-z0-9_-]{43}$/.test(secret.trim())&&window.confirm('Substituir a chave antiga e bloquear o cartão até você desbloqueá-lo?'))void execute('recover',undefined,secret.trim());}}>
    <p className="text-sm text-slate-300">Use o código secreto recebido na ativação. Você criará uma nova chave de acesso. A chave e o código anteriores perderão a validade; o endereço e o titular da tag serão preservados.</p>
    <label className="block text-sm">Código de recuperação<input type="password" autoComplete="off" spellCheck={false} maxLength={43} value={secret} disabled={busy} onChange={e=>setSecret(e.target.value)} className="mt-1 w-full rounded-lg bg-[#1D2924] p-3 font-mono"/></label>
    <button type="submit" className={orange} disabled={busy||!/^[A-Za-z0-9_-]{43}$/.test(secret.trim())}>Recuperar com nova chave de acesso</button>
   </form>}
  </>}
  {notice&&<p role="status" className="text-sm text-slate-200">{notice}</p>}
 </section>;
}
