export interface StoreCostCenterRef { id: string; name: string }
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
  const name=costCenterName(x.name);
  const fixed=FIXED_STORE_COST_CENTERS.find(c=>c.id===x.id);
  if(fixed&&fixed.name!==name)throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
  return {id:x.id,name};
}
// Fixed shared taxonomy: no registry or mutation per tenant.
export const FIXED_STORE_COST_CENTERS = [
  {id:'cc_infrastructure',name:'Infraestrutura'},
  {id:'cc_commercial',name:'Comercial'},
  {id:'cc_administrative',name:'Administrativo'},
  {id:'cc_products',name:'Produtos'},
  {id:'cc_logistics',name:'Logística'},
] as const;
export const INFRASTRUCTURE_COST_CENTER_ID = 'cc_infrastructure' as const;
export function selectStoreCostCenter(id:unknown): StoreCostCenterRef|undefined {
  // Old callers may omit the field; never infer a center for legacy data.
  if(id===undefined||id==='')return undefined;
  const center=FIXED_STORE_COST_CENTERS.find(c=>c.id===id);
  if(!center)throw Error('STORE_FINANCE_PAYABLE_COST_CENTER_INVALID');
  return {...center};
}
