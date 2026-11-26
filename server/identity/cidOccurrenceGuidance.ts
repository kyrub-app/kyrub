// Pure, advisory-only policy. No LLM, network, logging, external calls, automatic
// reporting, alert cancellation, moderation sanction, or modification of a chat.
// Use only text from an authorized occurrence; do not expose private suggestions
// to other participants. Classification is a heuristic, not a finding of fact.
export type CidGuidanceCategory='animal-found'|'object-found'|'accident'|'illness'|'test-or-mistake'|'unclear';
const prompts:Record<CidGuidanceCategory,string>={
 'animal-found':'Você encontrou um animal? Informe em que situação ele está e se existe um local público e seguro para combinar a devolução.',
 'object-found':'Você encontrou a Tag ou um objeto? Descreva a situação e combine uma devolução segura.',
 accident:'Se houver perigo imediato, utilize os serviços públicos de emergência. Você já solicitou atendimento?',
 illness:'Se houver necessidade de atendimento médico imediato, ligue 192. Você já solicitou ajuda?',
 'test-or-mistake':'Se foi um teste ou engano, informe isso aos participantes. O titular poderá encerrar a ocorrência.',
 unclear:'Descreva o que aconteceu e informe se alguém precisa de ajuda imediata.'
};
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
export function classifyCidOccurrence(reason:unknown,confirmedCategory?:unknown){
 const allowed=Object.keys(prompts) as CidGuidanceCategory[];
 const text=typeof reason==='string'?normalize(reason.slice(0,500)):'';
 const matches:CidGuidanceCategory[]=[];
 if(/\b(acidente|atropelamento|atropelado|colisao|incendio|desabamento|ferido|ferida)\b/.test(text))matches.push('accident');
 if(/\b(mal estar|desmaio|desmaiou|passando mal|convulsao|falta de ar)\b/.test(text))matches.push('illness');
 if(/\b(animal|cachorro|cadela|cao|gato|gata|pet)\b/.test(text)&&/\b(encontrei|encontrado|encontrada|perdido|perdida|achei|resgatei)\b/.test(text))matches.push('animal-found');
 if(/\b(tag|chave|chaveiro|objeto|carteira|mochila|bolsa|documento)\b/.test(text)&&/\b(encontrei|encontrado|encontrada|achei|perdido|perdida)\b/.test(text))matches.push('object-found');
 if(/\b(teste|engano|sem querer|acidentalmente)\b/.test(text))matches.push('test-or-mistake');
 // Multiple interpretations remain uncertain. Never downgrade possible emergencies
 // on the basis of a test/found keyword or a user-selected category.
 const urgent=matches.includes('accident')||matches.includes('illness');
 const selected=allowed.includes(confirmedCategory as CidGuidanceCategory)?confirmedCategory as CidGuidanceCategory:undefined;
 const category=selected??(matches.length===1?matches[0]:'unclear');
 const prompt=urgent&&category!=='accident'&&category!=='illness'?'Se houver perigo imediato, utilize os serviços públicos de emergência. '+prompts[category]:prompts[category];
 return {category,source:selected?'participant-confirmed' as const:'heuristic' as const,prompt,possibleEmergency:urgent,advisoryOnly:true as const};
}
export const CID_SAFE_RETURN_GUIDANCE='Combine a devolução em local público e seguro. Não compartilhe endereço residencial, credenciais ou dados bancários desnecessários. Se houver ameaça ou risco imediato, procure ajuda das autoridades competentes.';
export function assessCidReturnMessage(input:unknown,viewerRole:'owner'|'emitter'|'contact'){
 // Private guidance to the owner only; never label a participant a criminal.
 if(viewerRole!=='owner'||typeof input!=='string')return null;
 const text=normalize(input.slice(0,2000));
 const money=/\b(pix|dinheiro|pagamento|pagar|pague|deposito|depositar|transferencia|reais|valor|recompensa)\b/.test(text);
 const condition=/\b(so devolvo|so entrego|so libero|somente devolvo|somente entrego|se pagar|se nao pagar|se voce pagar|se voce nao pagar|se fizer o pix|devolvo depois de|entrego depois de)\b/.test(text);
 const returnContext=/\b(devolvo|devolver|entrego|entregar|libero|liberar|animal|cachorro|gato|tag|objeto)\b/.test(text);
 if(!money||!condition||!returnContext)return null;
 return {kind:'possible-conditional-payment' as const,privateTo:'owner' as const,advisoryOnly:true as const,text:'A mensagem pode indicar uma exigência de pagamento condicionada à devolução. Isso não comprova uma infração. Recompensa oferecida voluntariamente é diferente de pagamento exigido. Evite confrontos, preserve a conversa e, se necessário, procure as autoridades competentes. '+CID_SAFE_RETURN_GUIDANCE};
}
