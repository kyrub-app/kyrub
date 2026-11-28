import {createHash} from 'node:crypto';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {buildUserNotification,userNotificationPath} from '../../shared/userNotifications.js';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';

const messages={
 payment_reported:['Pagamento informado em Freelas','Consulte o financeiro do contrato para acompanhar o recebimento.'],
 nonreceipt_reported:['Não recebimento informado em Freelas','Consulte o financeiro do contrato para acompanhar as manifestações.'],
 receipt_reported:['Recebimento informado em Freelas','Consulte o financeiro do contrato. Não é confirmação bancária.'],
 receipt_confirmed:['Recebimento confirmado pelas partes','Consulte o financeiro de Freelas. Não é confirmação bancária.'],
 dispute_opened:['Divergência financeira em Freelas','Novas contratações estão temporariamente restritas. Regularize ou solicite análise pelo financeiro do contrato.'],
 review_requested:['Análise financeira solicitada','Acompanhe o protocolo em Freelas. A restrição deste caso permanece até resolução.'],
 voluntary_release:['Regularização financeira em Freelas','A restrição deste caso foi removida. Outras divergências podem manter restrições.'],
 administrative_release:['Análise financeira encerrada','A restrição deste caso foi removida. Consulte o resultado em Freelas. Outras divergências podem manter restrições.']
} as const;
export type FinancialNotice=keyof typeof messages;
/** Only invoked after canonical participant/obligation validation and only on
 * actual transitions. Atomic create: retries cannot reset an existing readAt.
 * Category system reuses the private Platform inbox; no browser push, no raw
 * party IDs beyond recipient, no title of service, amount, key or evidence. */
export function writeFreelanceFinancialNotices(tx:FirebaseFirestore.Transaction,obligation:FreelancePaymentObligation,kind:FinancialNotice,recordedAt:string,recipient:'both'|'requester'|'freelancer'='both'){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !['127.0.0.1:8088','localhost:8088'].includes(process.env.FIRESTORE_EMULATOR_HOST??'')||getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
 if(!validFreelanceId(obligation.offerId)||!validFreelanceId(obligation.requesterUid)||!validFreelanceId(obligation.beneficiaryUid)||obligation.requesterUid===obligation.beneficiaryUid)throw Error('FREELANCE_INVALID');
 const sourceId=createHash('sha256').update(JSON.stringify([obligation.offerId,kind])).digest('hex');
 const ids=recipient==='both'?[obligation.requesterUid,obligation.beneficiaryUid]:[recipient==='requester'?obligation.requesterUid:obligation.beneficiaryUid];
 for(const recipientUserId of ids){
  const [title,body]=messages[kind];
  const item=buildUserNotification({recipientUserId,category:'system',eventType:'freelance_finance_'+kind,sourceId,actorPrincipalId:'kyrub-system',title,body,target:{kind:'none'},createdAt:recordedAt});
  tx.create(adminDb.doc(userNotificationPath(recipientUserId,item.id)),item);
 }
}
