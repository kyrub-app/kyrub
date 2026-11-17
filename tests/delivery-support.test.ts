import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  KYRUB_COURIER_SUPPORT_REASONS,
  getCourierSupportReason,
  supportPriorityRank,
} from '../shared/deliverySupportReasons';

test('support topics are unique, contextual, and do not hide urgent safety',()=>{
  const codes=new Set<string>();
  for(const reason of KYRUB_COURIER_SUPPORT_REASONS){
    assert.match(reason.code,/^[a-z_]+$/);
    assert.equal(codes.has(reason.code),false,reason.code);
    codes.add(reason.code);
    assert.ok(reason.label.length>3);
    assert.ok(reason.guidance.length>25);
    assert.ok(reason.stages.length>0);
    for(const stage of reason.stages) {
      assert.equal(getCourierSupportReason(reason.code,stage)?.code,reason.code);
    }
  }
  assert.ok(KYRUB_COURIER_SUPPORT_REASONS.length>=15);
  assert.equal(getCourierSupportReason('merchant_closed','accepted')?.code,'merchant_closed');
  assert.equal(getCourierSupportReason('merchant_closed','delivering'),null);
  assert.equal(getCourierSupportReason('recipient_not_found','accepted'),null);
  assert.equal(getCourierSupportReason('recipient_not_found','delivering')?.code,'recipient_not_found');
  assert.equal(getCourierSupportReason('accident_or_injury','accepted')?.priority,'safety');
  assert.equal(getCourierSupportReason('accident_or_injury','delivering')?.priority,'safety');
  assert.equal(getCourierSupportReason('__unknown__','accepted'),null);
  assert.equal(supportPriorityRank('safety')<supportPriorityRank('urgent'),true);
  assert.equal(supportPriorityRank('urgent')<supportPriorityRank('normal'),true);
});

test('support reports are server-authorized, auditable and never equivalent to cancellation',()=>{
  const router=readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  const service=readFileSync('server/delivery/deliverySupportTicketService.ts','utf8');
  const dialog=readFileSync('src/components/store/CourierDeliverySupportDialog.tsx','utf8');
  const bridge=readFileSync('src/components/store/CourierLiveTrackingBridge.tsx','utf8');
  const admin=readFileSync('src/components/admin/AdminDeliverySupportQueue.tsx','utf8');
  const control=readFileSync('src/components/admin/AdminIdentityVerificationWorkspace.tsx','utf8');
  const rules=readFileSync('firestore.identity-verification.fragment.rules','utf8');

  assert.match(router,/router\.post\('\/:deliveryId\/support-tickets'/);
  assert.match(router,/router\.post\('\/admin\/support-tickets\/:ticketId\/respond'/);
  assert.match(service,/adminDb\.runTransaction/);
  assert.match(service,/claim\.courierId !== courierId/);
  assert.match(service,/delivery\.acceptedBy !== courierId/);
  assert.match(service,/getCourierSupportReason\(input\.reasonCode,stage\)/);
  assert.match(service,/ticketSnap\.exists/);
  assert.match(service,/DELIVERY_SUPPORT_RATE_LIMIT/);
  assert.match(service,/transaction\.create\(eventRef/);
  assert.doesNotMatch(service,/transaction\.update\(deliveryRef/);
  assert.doesNotMatch(service,/transaction\.update\(claimRef/);
  assert.doesNotMatch(service,/economicObligationPath|economicSettlements|providerPayment/);
  assert.match(dialog,/tel:\$\{item\.phone\}/);
  assert.match(dialog,/sem garantia de atendimento imediato/);
  assert.match(bridge,/Abrir suporte desta entrega/);
  assert.match(bridge,/Solicitar suporte nesta entrega/);
  assert.match(bridge,/panelDismissed/);
  assert.match(admin,/Suporte às entregas/);
  assert.match(control,/AdminDeliverySupportQueue/);
  assert.match(rules,/match \/deliverySupportTickets\/\{ticketId\}/);
  assert.match(rules,/match \/deliverySupportTicketEvents\/\{eventId\}/);
});

test('courier support only enables absence actions after fresh server-confirmed arrival',()=>{
  const dialog=readFileSync('src/components/store/CourierDeliverySupportDialog.tsx','utf8');
  const tracking=readFileSync('src/components/store/CourierLiveTrackingBridge.tsx','utf8');
  const queue=readFileSync('src/components/admin/AdminDeliverySupportQueue.tsx','utf8');
  assert.match(tracking,/handoff\.status === 'awaiting_buyer_confirmation'/);
  assert.match(tracking,/handoff\.arrivedByCourierId === user\.uid/);
  assert.match(tracking,/handoff\.trackingWasActive === true/);
  assert.match(tracking,/!snapshot\.metadata\.fromCache/);
  assert.match(tracking,/recipientArrivalVerified: arrivalVerified/);
  assert.match(tracking,/recipientArrivalVerified=\{activeDelivery\.recipientArrivalVerified\}/);
  assert.match(tracking,/vehicleType=\{activeDelivery\.vehicleType\}/);
  assert.match(dialog,/vehicleType=\{vehicleType\}/);
  assert.match(dialog,/disabled=\{Boolean\(evidenceBusy\)\|\|!recipientArrivalVerified\}/);
  assert.match(dialog,/disabled=\{Boolean\(evidenceBusy\)\|\|!recipientArrivalVerified\|\|ticket\.contactAttemptsCount<1\}/);
  assert.match(dialog,/A chegada ao destinatário ainda não foi confirmada pelo servidor/);
  assert.match(dialog,/Dez minutos são apenas referência de mercado/);
  assert.match(queue,/orderBy\('createdAt','desc'\),limit\(100\)/);
  assert.match(queue,/t\.priority==='safety'\?0/);
});

test('recipient absence uses server arrival and declarative contact attempts, never automatic return',async()=>{
  const absence=await import('../server/delivery/deliveryRecipientAbsenceEvidenceService');
  assert.equal(absence.RECIPIENT_WAIT_REFERENCE_MS,600_000);
  assert.equal(absence.MAX_DECLARED_CONTACT_ATTEMPTS,12);
  const service=readFileSync('server/delivery/deliveryRecipientAbsenceEvidenceService.ts','utf8');
  const router=readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  const dialog=readFileSync('src/components/store/CourierDeliverySupportDialog.tsx','utf8');
  const admin=readFileSync('src/components/admin/AdminDeliverySupportQueue.tsx','utf8');
  assert.match(service,/handoff\.arrivedAt/);
  assert.match(service,/handoff\.arrivedByCourierId!==courierId/);
  assert.match(service,/handoff\.trackingWasActive!==true/);
  assert.match(service,/contact_attempt_declared/);
  assert.match(service,/evidenceLevel:'courier_self_declared'/);
  assert.match(service,/recipient_absence_review_requested/);
  assert.match(service,/transaction\.create\(eventRef/);
  assert.doesNotMatch(service,/transaction\.update\(deliveryRef/);
  assert.doesNotMatch(service,/transaction\.update\(claimRef/);
  assert.doesNotMatch(service,/deliveryReturns|economicObligationPath|paymentIntent/);
  assert.match(router,/router\.post\('\/support-tickets\/:ticketId\/contact-attempt'/);
  assert.match(router,/router\.post\('\/support-tickets\/:ticketId\/request-absence-review'/);
  assert.match(dialog,/Solicitar análise da logística — não devolver/);
  assert.match(dialog,/Dez minutos são apenas referência de mercado/);
  assert.match(admin,/Revisão solicitada em/);
});
