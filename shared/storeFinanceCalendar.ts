export type FinancePeriodTimeZone = 'UTC' | 'America/Sao_Paulo';
export type FinanceMonthRange = {period:string;timeZone:FinancePeriodTimeZone;startIso:string;endExclusiveIso:string};
const formatter = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'});
export function parseFinancePeriodTimeZone(value:unknown):FinancePeriodTimeZone {
  if(value===undefined||value==='UTC') return 'UTC';
  if(value==='America/Sao_Paulo') return value;
  throw Error('STORE_FINANCE_HISTORY_PERIOD_INVALID');
}
const monthOrdinal=(ms:number,zone:FinancePeriodTimeZone):number=>{
  const date=new Date(ms);
  if(zone==='UTC')return date.getUTCFullYear()*12+date.getUTCMonth();
  const parts=formatter.formatToParts(date);
  return Number(parts.find(p=>p.type==='year')?.value)*12+Number(parts.find(p=>p.type==='month')?.value)-1;
};
export function financeMonthAt(date:Date,zone:FinancePeriodTimeZone):string {
  if(!Number.isFinite(date.getTime()))throw Error('STORE_FINANCE_HISTORY_PERIOD_INVALID');
  const n=monthOrdinal(date.getTime(),parseFinancePeriodTimeZone(zone));
  return String(Math.floor(n/12)).padStart(4,'0')+'-'+String(n%12+1).padStart(2,'0');
}
// Find first instant of the local month with Intl tz rules, including historical
// daylight saving; do not assume a constant -03:00 offset.
const boundary=(year:number,monthIndex:number,zone:FinancePeriodTimeZone):number=>{
  const utc=Date.UTC(year,monthIndex,1);
  if(zone==='UTC')return utc;
  const target=year*12+monthIndex;
  let lo=utc-2*86400000,hi=utc+2*86400000;
  while(lo<hi){
    const mid=lo+Math.floor((hi-lo)/2);
    if(monthOrdinal(mid,zone)<target)lo=mid+1;
    else hi=mid;
  }
  if(monthOrdinal(lo,zone)!==target||monthOrdinal(lo-1,zone)>=target)
    throw Error('STORE_FINANCE_HISTORY_PERIOD_INVALID');
  return lo;
};
export function financeMonthRange(period:string,zone:FinancePeriodTimeZone='UTC'):FinanceMonthRange {
  const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if(!match||Number(match[1])<2000||Number(match[1])>9999)throw Error('STORE_FINANCE_HISTORY_PERIOD_INVALID');
  const timeZone=parseFinancePeriodTimeZone(zone);
  const year=Number(match[1]),monthIndex=Number(match[2])-1;
  return {period,timeZone,startIso:new Date(boundary(year,monthIndex,timeZone)).toISOString(),
    endExclusiveIso:new Date(boundary(year,monthIndex+1,timeZone)).toISOString()};
}
