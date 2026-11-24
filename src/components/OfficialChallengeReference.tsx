import {useState} from 'react';
import {usePlatformChallenges} from '../hooks/usePlatformChallenges';
import type {PlatformChallengeView} from '../../shared/platformChallengeCatalog';

/** A disclosure is a reference to a server-owned challenge, never a claim. */
export function OfficialChallengeReference({challengeId,viewerId}:{challengeId:string;viewerId:string}){
 const [open,setOpen]=useState(false);
 return <section className="mt-3 space-y-2 rounded-xl border border-teal-800/60 p-3 text-sm">
   <button type="button" aria-expanded={open} disabled={!viewerId} className="min-h-11 w-full rounded-xl border border-teal-700 px-3 font-bold text-teal-200 disabled:opacity-50" onClick={()=>setOpen(v=>!v)}>{open?'Fechar desafio':'Ver desafio'}</button>
   {open&&viewerId&&<OfficialChallengeDetails key={viewerId+':'+challengeId} challengeId={challengeId} viewerId={viewerId}/>}
 </section>;
}

function OfficialChallengeDetails({challengeId,viewerId}:{challengeId:string;viewerId:string}){
 const {catalog,loading,error,retry}=usePlatformChallenges(true,viewerId);
 const challenge:PlatformChallengeView|undefined=catalog?.challenges.find(item=>item.id===challengeId);
 return <div className="space-y-2" aria-label="Detalhes do desafio da plataforma">
   {loading?<p role="status">Consultando desafio…</p>:error?<p role="alert">{error}</p>:!challenge?<p role="status">Desafio indisponível para esta conta ou neste momento.</p>:<>
     <p className="font-bold text-white">{challenge.title}</p>
     <p className="whitespace-pre-wrap break-words text-slate-300">{challenge.description}</p>
     <p className="text-teal-200">{challenge.status==='completed'?'Concluído com registro':'Disponível'}</p>
     <p>Recompensa prevista: {challenge.rewardXp} XP · {challenge.rewardPitangas} Pitangas</p>
     {challenge.status==='available'&&<p>Para concluir o desafio piloto, publique sua primeira loja na Catu. A confirmação é automática após a publicação verificada.</p>}
     <p className="text-xs text-slate-400">Consultar o desafio não concede recompensas.</p>
   </>}
   <button type="button" disabled={loading} className="min-h-10 rounded-lg border border-slate-700 px-3 text-xs" onClick={retry}>Atualizar situação</button>
 </div>;
}
