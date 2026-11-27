import {createHash} from 'node:crypto';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {buildUserNotification,userNotificationPath} from '../../shared/userNotifications.js';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';

const messages={
 hourly_excess_proposed:['Excedente de jornada em análise','Consulte a proposta de reconhecimento de tempo adicional.'],
 hourly_excess_accepted:['Excedente de jornada acordado','Consulte a resolução. Nenhum pagamento foi confirmado.'],
 hourly_excess_closed:['Proposta de excedente encerrada','Consulte a apuração da jornada.'],
 hourly_cancellation_admin_resolved:['Análise de cancelamento concluída','Consulte a decisão financeira. A restrição deste caso foi removida; nenhum pagamento foi confirmado.'],
 hourly_cancellation_disputed:['Divergência no cancelamento','Novas contratações temporariamente restritas. Busque acordo no financeiro do contrato.'],
 hourly_cancellation_review_requested:['Análise de cancelamento solicitada','Consulte a situação financeira do contrato. A restrição permanece até resolução.'],
 hourly_cancellation_proposed:['Acordo de cancelamento proposto','Consulte o valor proposto em Freelas antes de decidir.'],
 hourly_cancellation_accepted:['Acordo de cancelamento aceito','Consulte o valor reconhecido. Nenhum pagamento foi confirmado.'],
 hourly_cancellation_closed:['Proposta de cancelamento encerrada','Consulte o financeiro de Freelas. Nenhum pagamento foi confirmado.'],
 cancellation_accounting_proposed:['Apuração de cancelamento proposta','Consulte a apuração financeira de Freelas e confira os valores antes de aceitar.'],
 cancellation_accounting_accepted:['Apuração de cancelamento aceita','Consulte a apuração acordada. Isso não confirma pagamento ou devolução.'],
 cancellation_accounting_closed:['Proposta de apuração encerrada','Consulte o financeiro de Freelas. Nenhum pagamento ou devolução foi confirmado.'],
 pix_rebind_proposed:['Substituição de chave Pix solicitada','Consulte o financeiro do contrato. Se já pagou, não aceite a troca nem repita a transferência.'],
 pix_rebind_accepted:['Substituição de chave Pix aceita','Consulte o financeiro do contrato e autorize o novo compartilhamento antes de disponibilizar a chave.'],
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
export function writeFreelanceFinancialNotices(tx:FirebaseFirestore.Transaction,obligation:Pick<FreelancePaymentObligation,'offerId'|'requesterUid'|'beneficiaryUid'>,kind:FinancialNotice,recordedAt:string,recipient:'both'|'requester'|'freelancer'='both',revision?:number|string){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !['127.0.0.1:8088','localhost:8088'].includes(process.env.FIRESTORE_EMULATOR_HOST??'')||getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
 if(!validFreelanceId(obligation.offerId)||!validFreelanceId(obligation.requesterUid)||!validFreelanceId(obligation.beneficiaryUid)||obligation.requesterUid===obligation.beneficiaryUid)throw Error('FREELANCE_INVALID');
 const replacement=kind==='pix_rebind_proposed'||kind==='pix_rebind_accepted';
 const accounting=kind.startsWith('cancellation_accounting_')||kind.startsWith('hourly_cancellation_')||kind.startsWith('hourly_excess_');
 if(replacement?(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1):accounting?!validFreelanceId(revision):revision!==undefined)throw Error('FREELANCE_INVALID');
 const sourceId=createHash('sha256').update(JSON.stringify(replacement||accounting?[obligation.offerId,kind,revision]:[obligation.offerId,kind])).digest('hex');
 const ids=recipient==='both'?[obligation.requesterUid,obligation.beneficiaryUid]:[recipient==='requester'?obligation.requesterUid:obligation.beneficiaryUid];
 for(const recipientUserId of ids){
  const [title,body]=messages[kind];
  const item=buildUserNotification({recipientUserId,category:'system',eventType:'freelance_finance_'+kind,sourceId,actorPrincipalId:'kyrub-system',title,body,target:{kind:'none'},createdAt:recordedAt});
  tx.create(adminDb.doc(userNotificationPath(recipientUserId,item.id)),item);
 }
}
