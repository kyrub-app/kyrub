export const STORE_FINANCE_SECTIONS=['overview','payables','receivables','cash','movements'] as const;
export type StoreFinanceSection=typeof STORE_FINANCE_SECTIONS[number];
export function parseStoreFinanceSection(value:unknown):StoreFinanceSection|'all'{
  if(value===undefined)return 'all';
  if(typeof value==='string'&&(STORE_FINANCE_SECTIONS as readonly string[]).includes(value))return value as StoreFinanceSection;
  throw Error('STORE_FINANCE_SECTION_INVALID');
}
