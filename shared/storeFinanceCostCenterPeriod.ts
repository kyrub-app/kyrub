import type { FinancePeriodTimeZone } from './storeFinanceCalendar.js';
import type { StoreCostCenterRef } from './storeFinanceCostCenters.js';

export interface StoreCostCenterPeriodRow {
  id: string | null;
  name: string;
  paidMinor: number;
  paidCount: number;
  openDueMinor: number;
  openDueCount: number;
}
export interface StoreCostCenterPeriodReport {
  timeZone: FinancePeriodTimeZone;
  status: 'observed' | 'partial' | 'unavailable';
  invalidPayableCount: number;
  rows: StoreCostCenterPeriodRow[];
}
type Totals = Pick<StoreCostCenterPeriodRow,'paidMinor'|'paidCount'|'openDueMinor'|'openDueCount'>;
const add = (a:number,b:number):number => {
  const sum=a+b;
  if(!Number.isSafeInteger(sum)||sum<0) throw Error('COST_CENTER_TOTAL_INVALID');
  return sum;
};

// Consumes the SAME normalized payable rows and period predicates as the
// existing finance report. No DB, no additional scan, no inferred expenses.
export function createStoreCostCenterPeriodAccumulator(timeZone:FinancePeriodTimeZone='UTC') {
  const rows=new Map<string|null,StoreCostCenterPeriodRow>();
  let invalidPayableCount=0;
  let inconsistent=false;
  return {
    invalidPayable() {invalidPayableCount++;},
    add(center:StoreCostCenterRef|undefined, amountMinor:number, kind:'paid'|'open_due') {
      if(inconsistent) return;
      try {
        if(!Number.isSafeInteger(amountMinor)||amountMinor<=0) throw Error('COST_CENTER_AMOUNT_INVALID');
        const id=center?.id??null, name=center?.name??'Sem classificação';
        const key=id?.startsWith('cc_custom_')?JSON.stringify([id,name]):id;
        const row=rows.get(key)??{id,name,paidMinor:0,paidCount:0,openDueMinor:0,openDueCount:0};
        if(row.name!==name) throw Error('COST_CENTER_HISTORY_CONFLICT');
        const next=kind==='paid'
          ? {...row,paidMinor:add(row.paidMinor,amountMinor),paidCount:add(row.paidCount,1)}
          : {...row,openDueMinor:add(row.openDueMinor,amountMinor),openDueCount:add(row.openDueCount,1)};
        rows.set(key,next);
      } catch {inconsistent=true;}
    },
    finish(expected:Totals):StoreCostCenterPeriodReport {
      try {
        if(inconsistent) throw Error('COST_CENTER_INCONSISTENT');
        const result=[...rows.values()].sort((a,b)=>b.paidMinor-a.paidMinor||b.openDueMinor-a.openDueMinor||a.name.localeCompare(b.name,'pt-BR'));
        const total=result.reduce((sum,row)=>({
          paidMinor:add(sum.paidMinor,row.paidMinor),paidCount:add(sum.paidCount,row.paidCount),
          openDueMinor:add(sum.openDueMinor,row.openDueMinor),openDueCount:add(sum.openDueCount,row.openDueCount),
        }),{paidMinor:0,paidCount:0,openDueMinor:0,openDueCount:0});
        if(total.paidMinor!==expected.paidMinor||total.paidCount!==expected.paidCount||
          total.openDueMinor!==expected.openDueMinor||total.openDueCount!==expected.openDueCount)
          throw Error('COST_CENTER_UNRECONCILED');
        return {timeZone,status:invalidPayableCount?'partial':'observed',invalidPayableCount,rows:result};
      } catch {return {timeZone,status:'unavailable',invalidPayableCount,rows:[]};}
    },
  };
}
