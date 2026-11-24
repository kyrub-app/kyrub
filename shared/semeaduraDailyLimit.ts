/** One shared daily sending allowance across every canonical post kind.
 * The server clock is authoritative; no timezone or date supplied by clients. */
export const SEMEADURA_DAILY_LIMIT=100 as const;
export const SEMEADURA_DAY_TIMEZONE='America/Sao_Paulo';
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:SEMEADURA_DAY_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function semeaduraDay(at:Date):string{
 const parts=formatter.formatToParts(at);
 const part=(type:string)=>parts.find(p=>p.type===type)?.value;
 return [part('year'),part('month'),part('day')].join('-');
}
export function readSemeaduraDailyCount(data:Record<string,unknown>|undefined,actorId:string,day:string):number{
 if(data===undefined)return 0;
 if(data.actorId!==actorId||data.day!==day||data.schemaVersion!==1||
    typeof data.count!=='number'||!Number.isSafeInteger(data.count)||data.count<1||data.count>SEMEADURA_DAILY_LIMIT)
  throw Error('SEMEADURA_DAILY_COUNTER_INVALID');
 return data.count;
}
