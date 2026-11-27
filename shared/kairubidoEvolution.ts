/** Cosmetic projection of canonical XP. No economic award, role, certification,
 * reputation, or professional experience is granted by an avatar accessory.
 * The thresholds are deliberately external to this pure model. */
export const KAIRUBIDO_EQUIPMENT=['arco_e_flecha','bracelete','colar','faixa','pena','cocar_parcial','cocar'] as const;
export type KairubidoEquipment=typeof KAIRUBIDO_EQUIPMENT[number];
export type KairubidoMilestone={equipment:KairubidoEquipment;minimumXp:number};
export function projectKairubidoEvolution(xp:unknown,milestones:readonly KairubidoMilestone[]){
 const fail=():never=>{throw Error('KAIRUBIDO_EVOLUTION_INVALID');};
 if(typeof xp!=='number'||!Number.isSafeInteger(xp)||xp<0||!Array.isArray(milestones)||milestones.length!==KAIRUBIDO_EQUIPMENT.length)return fail();
 for(let i=0;i<milestones.length;i++){
  const m=milestones[i];
  if(!m||m.equipment!==KAIRUBIDO_EQUIPMENT[i]||!Number.isSafeInteger(m.minimumXp)||m.minimumXp<0||
   (i===0?m.minimumXp!==0:m.minimumXp<=milestones[i-1].minimumXp))return fail();
 }
 const unlocked=milestones.filter(m=>m.minimumXp<=xp).map(m=>m.equipment);
 const next=milestones[unlocked.length];
 return {xp,level:unlocked.length,unlocked,next:next?{equipment:next.equipment,minimumXp:next.minimumXp,remainingXp:next.minimumXp-xp}:null};
}
