// The cleanup is strictly a one-time archival of the known Kyrub Oficial
// test records. Everything else must fail closed, never become a general tool.
export const KYRUB_OFFICIAL_TEST_HISTORY_STORE='store-ae53dc42e57eb9d5c3f7151c1431';
export const KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION='LIMPAR TESTES DA KYRUB OFICIAL';
export function validKyrubOfficialTestHistoryRequest(body:unknown):body is {
 action:'archive-and-clear';storeId:string;digest:string;confirmation:string
}{
 if(!body||typeof body!=='object'||Array.isArray(body))return false;
 const r=body as Record<string,unknown>;
 return Object.keys(r).length===4&&r.action==='archive-and-clear'&&
   r.storeId===KYRUB_OFFICIAL_TEST_HISTORY_STORE&&
   typeof r.digest==='string'&&/^[0-9a-f]{64}$/.test(r.digest)&&
   r.confirmation===KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION;
}
