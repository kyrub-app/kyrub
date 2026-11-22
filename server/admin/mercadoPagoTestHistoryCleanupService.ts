import {createHash} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {loadMercadoPagoMerchantPixMigrationInventory} from './mercadoPagoMerchantPixMigrationInventoryService.js';

// One-time, narrowly scoped test history housekeeping. This does not cancel
// provider payments, change the marketplace or edit any OAuth connection.
const OFFICIAL='store-ae53dc42e57eb9d5c3f7151c1431';
const RUN='kyrub-oficial-test-history-2026-11-v1';
const EXPECTED={orders:5,intents:2,payments:4};
const MAX=24;
const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
const ref=(name:string)=>adminDb.doc(name);
const archiveRoot=`kyrub_admin/control_plane/financial_test_cleanup_runs/${RUN}`;
const hasExternalLink=(value:Record<string,unknown>)=>
  Boolean(clean(value.provider)||clean(value.providerPaymentId)||clean(value.providerIntentId)||
    clean(value.externalPaymentId)||clean(value.collectorId)||clean(value.recipientAccountId));
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const countsEqual=(c:{orders:number;intents:number;payments:number})=>
  c.orders===EXPECTED.orders&&c.intents===EXPECTED.intents&&c.payments===EXPECTED.payments;
const collections=(tenant:string)=>({
  orders:`artifacts/${tenant}/public/data/customerOrders`,
  intents:`stores/${OFFICIAL}/paymentIntents`,
  payments:`stores/${OFFICIAL}/payments`
});
type Row={path:string;id:string;data:Record<string,unknown>;updatedAt:string};
type Summary={storeId:string;counts:typeof EXPECTED;blocked:string[];canExecute:boolean;digest:string;archived:boolean};

const reason=(blocked:Set<string>,key:string,condition:boolean)=>{if(condition)blocked.add(key);};
export async function inspectOfficialTestHistory(actor:string,expectedDigest?:string,execute=false):Promise<Summary>{
  if(!actor)throw Error('TEST_HISTORY_FORBIDDEN');
  const inventory=await loadMercadoPagoMerchantPixMigrationInventory();
  if(!inventory.complete||inventory.rolloutMode!=='disabled')throw Error('TEST_HISTORY_SCOPE_BLOCKED');
  const matches=inventory.items.filter(item=>item.canonicalStoreId===OFFICIAL&&item.storeName==='Kyrub Oficial');
  if(matches.length!==1||matches[0].readiness==='identity_review')throw Error('TEST_HISTORY_SCOPE_BLOCKED');
  const tenantId=matches[0].tenantId;
  if(!/^[a-zA-Z0-9_-]{1,180}$/.test(tenantId))throw Error('TEST_HISTORY_SCOPE_BLOCKED');
  const paths=collections(tenantId);
  return adminDb.runTransaction(async tx=>{
    const adminRef=ref(`kyrub_admin/control_plane/admins/${actor}`);
    const runRef=ref(archiveRoot);
    const [admin,previous,orders,intents,payments]=await Promise.all([
      tx.get(adminRef),tx.get(runRef),
      tx.get(adminDb.collection(paths.orders).limit(MAX+1)),
      tx.get(adminDb.collection(paths.intents).limit(MAX+1)),
      tx.get(adminDb.collection(paths.payments).limit(MAX+1))
    ]);
    const a=admin.data();
    if(!admin.exists||a?.uid!==actor||a?.role!=='super_admin'||a?.status!=='active')throw Error('TEST_HISTORY_FORBIDDEN');
    const cs={orders:orders.size,intents:intents.size,payments:payments.size};
    const blocked=new Set<string>();
    reason(blocked,'CONTAGEM_DIVERGENTE',!countsEqual(cs));
    reason(blocked,'LEITURA_INCOMPLETA',Object.values(cs).some(n=>n>MAX));
    reason(blocked,'LIMPEZA_ANTERIOR',previous.exists);
    const groups={orders:orders.docs,intents:intents.docs,payments:payments.docs};
    const rows:Row[]=[];
    for(const [group,docs] of Object.entries(groups))for(const doc of docs){
      const data=doc.data() as Record<string,unknown>;
      rows.push({path:doc.ref.path,id:doc.id,data,updatedAt:doc.updateTime?.toMillis().toString()??''});
      reason(blocked,'REFERENCIA_EXTERNA',hasExternalLink(data));
      if(group==='payments'){
        reason(blocked,'PAGAMENTO_FINANCEIRO',[
          'paid','refund_requested','refund_processing','refunded','refund_failed','charged_back','chargeback_reversed'
        ].includes(clean(data.status))||Boolean(clean(data.paidAt)||clean(data.refundedAt)));
      }
      if(group==='intents')reason(blocked,'INTENCAO_FINANCEIRA',data.status==='paid');
      if(group==='orders'){
        reason(blocked,'LOJA_DIVERGENTE',data.storeId!==tenantId&&data.storeId!==OFFICIAL);
      }else reason(blocked,'LOJA_DIVERGENTE',data.storeId!==OFFICIAL);
    }
    // Read the relevant dependency collections with tight bounds. Any evidence
    // means this one-time operation must stop for manual reconciliation.
    const dependencyNames=[
      `stores/${OFFICIAL}/economicLedger`,
      `stores/${OFFICIAL}/storePointLedger`,
      `stores/${OFFICIAL}/paymentRefunds`,
      `stores/${OFFICIAL}/economicObligations`,
      `stores/${OFFICIAL}/economicSettlements`
    ];
    const dependencies=await Promise.all([
      ...dependencyNames.map(path=>tx.get(adminDb.collection(path).limit(1))),
      tx.get(adminDb.collection('paymentWebhookEvents').where('storeId','==',OFFICIAL).limit(1)),
      tx.get(adminDb.collection('paymentProviderBindings').where('canonicalStoreId','==',OFFICIAL).limit(1))
    ]);
    reason(blocked,'HISTORICO_FINANCEIRO_ASSOCIADO',dependencies.some(q=>!q.empty));
    const reservations=await Promise.all(orders.docs.map(d=>
      tx.get(ref(`inventoryOrderReservations/${hash(tenantId+':'+d.id)}`))
    ));
    reason(blocked,'RESERVA_ESTOQUE_ASSOCIADA',reservations.some(d=>d.exists));
    const orderSnapshots=await Promise.all(orders.docs.map(d=>tx.get(ref(`stores/${OFFICIAL}/orderCommercialSnapshots/${d.id}`))));
    reason(blocked,'SNAPSHOT_COMERCIAL_ASSOCIADO',orderSnapshots.some(d=>d.exists));
    // Canonical order mirrors are removed with the original orders, but never
    // without archived copies of each original/mirror.
    const mirrors=await Promise.all(orders.docs.map(d=>tx.get(ref(`stores/${OFFICIAL}/orders/${d.id}`))));
    for(const mirror of mirrors)if(mirror.exists)rows.push({
      path:mirror.ref.path,id:mirror.id,data:mirror.data() as Record<string,unknown>,
      updatedAt:mirror.updateTime?.toMillis().toString()??''
    });
    const digest=hash(rows.map(row=>row.path+'@'+row.updatedAt).sort().join('|')+'|'+tenantId);
    const result:Summary={storeId:OFFICIAL,counts:cs,blocked:[...blocked].sort(),canExecute:blocked.size===0,digest,archived:previous.exists};
    if(!execute)return result;
    if(typeof expectedDigest!=='string'||expectedDigest!==digest)throw Error('TEST_HISTORY_STALE_PREVIEW');
    if(blocked.size!==0)throw Error('TEST_HISTORY_BLOCKED');
    // Archive-before-delete is atomic. The original history is retained only
    // in a private audit location, not in the operational collections.
    tx.create(runRef,{
      storeId:OFFICIAL,tenantId,actorId:actor,kind:'test_history_archive',counts:cs,
      archivedRows:rows.length,digest,createdAt:FieldValue.serverTimestamp()
    });
    for(const [index,row] of rows.entries()){
      const archive=ref(`${archiveRoot}/records/r${String(index).padStart(3,'0')}`);
      tx.create(archive,{sourcePath:row.path,sourceData:row.data,sourceUpdatedAt:row.updatedAt});
      tx.delete(ref(row.path));
    }
    tx.create(ref(`kyrub_admin/control_plane/audit_logs/${RUN}`),{
      action:'admin.mercado_pago.test_history.archived',actorId:actor,actorRole:'super_admin',
      targetType:'store',targetId:OFFICIAL,counts:cs,createdAt:FieldValue.serverTimestamp()
    });
    return {...result,archived:true,canExecute:false,blocked:['LIMPEZA_CONCLUIDA']};
  });
}
