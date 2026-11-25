export const MAX_STORE_COST_CENTERS = 100;
export interface StoreCostCenterRef { id: string; name: string }
export interface StoreCostCenter extends StoreCostCenterRef { archived: boolean }
const validId=(id:unknown): id is string => typeof id==='string' && /^cc_[a-zA-Z0-9_-]{1,80}$/.test(id);
export function costCenterName(value:unknown): string {
  if(typeof value!=='string') throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
  const name=value.normalize('NFC').trim().replace(/\s+/g,' ');
  if(!name || name.length>80 || /[\u0000-\u001f\u007f]/.test(name)) throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
  return name;
}
export function normalizeCostCenterRef(value:unknown): StoreCostCenterRef {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
  const x=value as Partial<StoreCostCenterRef>;
  if(!validId(x.id)) throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
  return {id:x.id,name:costCenterName(x.name)};
}
export function normalizeCostCenters(value:unknown): StoreCostCenter[] {
  if(!Array.isArray(value) || value.length>MAX_STORE_COST_CENTERS) throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
  const ids=new Set<string>(), names=new Set<string>();
  return value.map(item=>{
    const x=normalizeCostCenterRef(item);
    const key=x.name.toLocaleLowerCase('pt-BR');
    if(typeof item.archived!=='boolean'||ids.has(x.id)||names.has(key)) throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
    ids.add(x.id); names.add(key);
    return {...x,archived:item.archived};
  });
}
export function createStoreCostCenter(centers:StoreCostCenter[], id:string, name:unknown): StoreCostCenter[] {
  return normalizeCostCenters([...centers,{id,name:costCenterName(name),archived:false}]);
}
export function archiveStoreCostCenter(centers:StoreCostCenter[],id:unknown): StoreCostCenter[] {
  if(!validId(id)||!centers.some(c=>c.id===id)) throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
  return normalizeCostCenters(centers.map(c=>c.id===id?{...c,archived:true}:c));
}
export function selectStoreCostCenter(centers:StoreCostCenter[],id:unknown): StoreCostCenterRef|undefined {
  if(id===undefined||id==='') return undefined;
  if(!validId(id)) throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
  const center=centers.find(c=>c.id===id&&!c.archived);
  if(!center) throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
  return {id:center.id,name:center.name};
}
