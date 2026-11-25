import { FIXED_STORE_COST_CENTERS, costCenterName, type StoreCostCenterRef } from './storeFinanceCostCenters.js';
export type FinanceTaxonomyKind='centers'|'categories';
export type FinanceTaxonomy={centers:StoreCostCenterRef[];categories:StoreCostCenterRef[]};
export const FIXED_CATEGORY_NAMES=['Fornecedor','Estoque / insumos','Aluguel','Água, luz e serviços básicos','Impostos e taxas','Serviços contratados','Folha / remuneração','Outros'];
export const emptyFinanceTaxonomy=():FinanceTaxonomy=>({centers:[],categories:[]});
const invalid=():never=>{throw Error('STORE_FINANCE_PAYABLE_TAXONOMY_INVALID');};
const nameKey=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const prefix=(kind:FinanceTaxonomyKind)=>kind==='centers'?'cc_custom_':'cat_custom_';
const isCustomId=(kind:FinanceTaxonomyKind,id:unknown):id is string=>typeof id==='string'&&id.startsWith(prefix(kind))&&/^[a-zA-Z0-9_-]{1,80}$/.test(id.slice(prefix(kind).length));
export function normalizeCustomFinanceRef(kind:FinanceTaxonomyKind,value:unknown):StoreCostCenterRef{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const x=value as Partial<StoreCostCenterRef>;
  if(!isCustomId(kind,x.id))return invalid();
  return {id:x.id,name:costCenterName(x.name)};
}
export function normalizeFinanceTaxonomy(value:unknown):FinanceTaxonomy{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const v=value as Partial<FinanceTaxonomy>, result=emptyFinanceTaxonomy();
  for(const kind of ['centers','categories'] as const){
    const list=v[kind];if(!Array.isArray(list)||list.length>100)return invalid();
    const names=new Set((kind==='centers'?FIXED_STORE_COST_CENTERS.map(x=>x.name):FIXED_CATEGORY_NAMES).map(nameKey)),ids=new Set<string>();
    for(const row of list){const item=normalizeCustomFinanceRef(kind,row),key=nameKey(item.name);
      if(ids.has(item.id)||names.has(key))return invalid();
      ids.add(item.id);names.add(key);result[kind].push(item);}
  }
  return result;
}
export function mutateFinanceTaxonomy(current:FinanceTaxonomy,kind:unknown,action:unknown,id:unknown,name:unknown):FinanceTaxonomy{
  if(kind!=='centers'&&kind!=='categories')return invalid();
  if(!isCustomId(kind,id))return invalid();
  const next=normalizeFinanceTaxonomy(current),list=next[kind],index=list.findIndex(x=>x.id===id);
  if(action==='create'){if(index!==-1)return invalid();list.push({id,name:costCenterName(name)});}
  else if(action==='rename'){if(index===-1)return invalid();list[index]={id,name:costCenterName(name)};}
  else if(action==='remove'){if(index===-1)return invalid();list.splice(index,1);}
  else return invalid();
  return normalizeFinanceTaxonomy(next);
}
export function resolveCustomFinanceRef(taxonomy:FinanceTaxonomy,kind:FinanceTaxonomyKind,id:unknown):StoreCostCenterRef{
  if(!isCustomId(kind,id))return invalid();
  const found=taxonomy[kind].find(x=>x.id===id);if(!found)return invalid();return {...found};
}
