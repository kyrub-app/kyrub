import {SEMEADURA_DAILY_LIMIT} from './semeaduraDailyLimit.js';

/** Spendable recognition allowance is not the author's lifetime seed progress.
 * Pure policy only: no grant, receipt, wallet write, or production enablement. */
export type SeedReserve={earned:number;spent:number};
function count(n:unknown):n is number{return typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;}
export function projectSeedAllowance(dailyUsed:number,reserve:SeedReserve){
 if(!count(dailyUsed)||dailyUsed>SEMEADURA_DAILY_LIMIT||!reserve||!count(reserve.earned)||!count(reserve.spent)||reserve.spent>reserve.earned)
  throw Error('SEMEADURA_RESERVE_INVALID');
 return {dailyRemaining:SEMEADURA_DAILY_LIMIT-dailyUsed,reserveRemaining:reserve.earned-reserve.spent};
}
/** Invoke only after a canonical new semeadura is accepted, in the same
 * transaction as the receipt and author progress. Duplicate/closed/denied
 * attempts must never invoke a debit. The day rollover resets daily usage only. */
export function planSeedAllowanceDebit(dailyUsed:number,reserve:SeedReserve){
 const view=projectSeedAllowance(dailyUsed,reserve);
 if(view.dailyRemaining>0)return {source:'daily' as const,dailyUsed:dailyUsed+1,reserve:{...reserve}};
 if(view.reserveRemaining>0)return {source:'reserve' as const,dailyUsed,reserve:{earned:reserve.earned,spent:reserve.spent+1}};
 throw Error('SEMEADURA_DAILY_LIMIT_REACHED');
}
/** Award size must be explicitly supplied by an approved, server-owned policy.
 * This is arithmetic, NOT authorization to grant. A future transactional
 * immutable reputation receipt must guarantee one grant per eligible event. */
export function planReputationSeedGrant(reserve:SeedReserve,approvedAmount:number){
 projectSeedAllowance(0,reserve);
 if(!count(approvedAmount)||approvedAmount===0||!Number.isSafeInteger(reserve.earned+approvedAmount))throw Error('SEMEADURA_RESERVE_INVALID');
 return {earned:reserve.earned+approvedAmount,spent:reserve.spent};
}
