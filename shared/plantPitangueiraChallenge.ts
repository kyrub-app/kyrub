import {assertKyrubChallengeDefinition,type KyrubChallengeDefinition} from './gamification.js';

export const PLANT_PITANGUEIRA_CHALLENGE_ID='plant_pitangueira_v1';
/** Approved permanent challenge, not an active campaign or a credit authority. */
export function createPlantPitangueiraDraft():KyrubChallengeDefinition{
 return assertKyrubChallengeDefinition({
  id:PLANT_PITANGUEIRA_CHALLENGE_ID,
  title:'Plante uma pitangueira',
  description:'Cultive no mundo real aquilo que você semeia no Kyrub. Plante uma pitangueira em local adequado e envie uma fotografia do plantio para validação privada. Em espaços públicos, obtenha autorização. Não é necessário comprar a muda na Loja Kyrub nem publicar sua localização.',
  status:'draft',validationMode:'manual_review',sponsorType:'kyrub',
  rewardKCoins:200,rewardXp:0,maxCompletionsPerUser:1,
 });
}
/** The reserved identifier cannot be reused to change the reward or validation.
 * No expiry or total completion cap: the planned challenge is permanent. */
export function assertPlantPitangueiraDraft(input:KyrubChallengeDefinition){
 if(input.id!==PLANT_PITANGUEIRA_CHALLENGE_ID)return;
 const expected=createPlantPitangueiraDraft();
 const keys=Object.keys(expected) as (keyof KyrubChallengeDefinition)[];
 if(Object.keys(input).length!==keys.length||keys.some(k=>input[k]!==expected[k]))
  throw Error('CHALLENGE_PLANT_PITANGUEIRA_DRAFT_INVALID');
}
/** Release gate: do not advertise a reward for which there is no safe evidence,
 * review and exactly-once canonical credit path. Replace only after homologation. */
export function assertPlantPitangueiraPublicationReady(id:string){
 if(id===PLANT_PITANGUEIRA_CHALLENGE_ID)throw Error('CHALLENGE_PLANT_PITANGUEIRA_NOT_READY');
}
