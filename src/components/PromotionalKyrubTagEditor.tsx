import {useState} from 'react';
import {auth} from '../utils/firebase';
import {EMPTY_PROMOTIONAL_PRESENTATION,type PromotionalTagPresentation} from '../../shared/kyrubTagPromotional';
import type {OwnedKyrubTag} from '../../shared/kyrubTagContract';

export function PromotionalKyrubTagEditor({initial,oneTimeRecoveryCode}:{initial:OwnedKyrubTag;oneTimeRecoveryCode?:string|null}){
 const [tag,setTag]=useState(initial);
 const [presentation,setPresentation]=useState<PromotionalTagPresentation>(initial.presentation??EMPTY_PROMOTIONAL_PRESENTATION);
 const [recoveryCode,setRecoveryCode]=useState(oneTimeRecoveryCode??'');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const set=(key:keyof PromotionalTagPresentation,value:string)=>setPresentation(current=>({...current,[key]:value}));
 async function execute(action:'configure-promotional'|'block-promotional'|'unblock-promotional',extras:Record<string,unknown>={}){
  if(busy||!auth.currentUser)return;
  setBusy(true);setNotice('');
  try{
   const token=await auth.currentUser.getIdToken(true);
   const res=await fetch('/api/health?transport=manage-kyrub-tag&id='+encodeURIComponent(tag.id),{
    method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({action,...extras})
   });
   if(!res.ok)throw Error('TAG_FAILED');
   const updated=await res.json() as OwnedKyrubTag;
   if(updated.id!==tag.id||updated.distribution!=='promotional')throw Error('TAG_FAILED');
   setTag(updated);
   setNotice(action==='configure-promotional'?'Sua apresentação foi publicada.':action==='block-promotional'?'Sua tag foi bloqueada. Seu cartão não está mais público.':'Bloqueio removido. Revise e publique a apresentação para reativá-la.');
  }catch{setNotice('Não foi possível concluir. Confira sua sessão e tente novamente.');}
  finally{setBusy(false);}
 }
 async function rotateRecovery(){
  if(busy||!auth.currentUser)return;
  if(!window.confirm('Gerar um novo código de recuperação? O código antigo será invalidado. Guarde o novo em um local seguro.'))return;
  setBusy(true);setNotice('');
  try{
   const token=await auth.currentUser.getIdToken(true);
   const res=await fetch('/api/health?transport=manage-kyrub-tag&id='+encodeURIComponent(tag.id),{
    method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({action:'rotate-promotional-recovery'})
   });
   if(!res.ok)throw Error('TAG_FORBIDDEN');
   const result=await res.json() as {tag:OwnedKyrubTag;recoveryCode:string};
   if(result.tag.id!==tag.id||result.tag.distribution!=='promotional'||!/^[a-f0-9]{48}$/.test(result.recoveryCode))throw Error('TAG_INVALID');
   setTag(result.tag);setRecoveryCode(result.recoveryCode);
   setNotice('O código anterior foi invalidado. Guarde o novo código antes de sair desta tela.');
  }catch{setNotice('Não foi possível substituir o código. Confira sua sessão e tente novamente.');}
  finally{setBusy(false);}
 }
 return <section className="space-y-4 rounded-[24px] bg-[#121A17] p-5 text-[#F5F5F3]">
  <header className="space-y-1">
   <p className="text-sm font-semibold uppercase tracking-wide text-[#F47825]">Kyrub Tag · Adesivo promocional</p>
   <h1 className="text-2xl font-bold">Sua apresentação, do seu jeito.</h1>
   <p className="text-sm text-slate-300">Edite as informações que deseja compartilhar. Sua identidade é protegida pelo e-mail verificado da conta.</p>
  </header>
  <div className="rounded-xl border border-[#34443B] p-3 text-sm">
   <strong>Estado: {tag.blocked?'Bloqueada por segurança':tag.enabled?'Pública':'Ainda não publicada'}</strong>
   <p className="mt-1 text-slate-300">Somente quem tiver acesso à sua identidade autenticada poderá gerenciar esta unidade.</p>
  </div>
  {recoveryCode&&<div className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
    <strong>Guarde seu código de recuperação</strong>
    <p>Ele é exibido uma única vez e permite recuperar o gerenciamento caso você perca o acesso ao e-mail. Não grave na etiqueta nem compartilhe.</p>
    <code className="block break-all select-all rounded-lg bg-[#121A17] p-2 font-mono text-sm">{recoveryCode}</code>
    <button type="button" className="rounded-lg border border-amber-400/50 p-2" onClick={()=>void navigator.clipboard.writeText(recoveryCode).then(()=>setNotice('Código copiado. Guarde em local privado.')).catch(()=>setNotice('Selecione o código e copie manualmente.'))}>Copiar código</button>
    <button type="button" className="ml-2 underline" onClick={()=>setRecoveryCode('')}>Já guardei</button>
   </div>}
  <div className="rounded-xl border border-[#34443B] bg-[#1D2924] p-3 text-sm text-slate-300">
   <strong className="text-white">Foto de perfil e capa</strong>
   <p>Planejadas para uma etapa com armazenamento validado; nenhuma foto é enviada nesta versão inicial.</p>
  </div>
  <label className="block text-sm">Nome de apresentação
   <input className="mt-1 min-h-11 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" value={presentation.name} maxLength={80} disabled={busy} placeholder="Como deseja ser chamado?" onChange={e=>set('name',e.target.value)}/>
  </label>
  <label className="block text-sm">O que você faz?
   <input className="mt-1 min-h-11 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" value={presentation.occupation} maxLength={90} disabled={busy} placeholder="Ex.: Entregador, comerciante, autônomo" onChange={e=>set('occupation',e.target.value)}/>
  </label>
  <label className="block text-sm">Sobre você
   <textarea className="mt-1 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" rows={3} value={presentation.about} maxLength={320} disabled={busy} placeholder="Uma breve apresentação" onChange={e=>set('about',e.target.value)}/>
  </label>
  <section className="rounded-xl border border-[#34443B] p-3">
   <strong>Informações de emergência</strong>
   <p className="mt-1 text-sm text-slate-300">O botão SOS exibirá os números públicos brasileiros 190, 192 e 193. Contatos particulares só serão incluídos após validações de privacidade.</p>
  </section>
  <button type="button" className="min-h-12 w-full rounded-xl bg-[#F47825] px-3 font-bold text-[#121A17] disabled:opacity-50" disabled={busy||tag.blocked} onClick={()=>void execute('configure-promotional',{presentation})}>Salvar e publicar minha apresentação</button>
  <button type="button" className="min-h-11 w-full rounded-xl border border-[#34443B] p-3 text-sm disabled:opacity-50" disabled={busy} onClick={()=>void rotateRecovery()}>Gerar novo código de recuperação</button>
  {tag.blocked?
   <button type="button" className="min-h-11 w-full rounded-xl border border-amber-600/60 p-3 disabled:opacity-50" disabled={busy} onClick={()=>void execute('unblock-promotional')}>Desbloquear minha Tag</button>:
   <button type="button" className="min-h-11 w-full rounded-xl border border-rose-500/60 p-3 text-rose-200 disabled:opacity-50" disabled={busy} onClick={()=>{if(window.confirm('Bloquear esta unidade por perda? O cartão deixará de ser público, e o vínculo permanecerá.'))void execute('block-promotional');}}>Perdi minha Tag · Bloquear</button>}
  {notice&&<p role="status" className="text-sm text-slate-200">{notice}</p>}
 </section>;
}
