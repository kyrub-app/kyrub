import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDeliveryPaidWaitingCourierObligation } from '../shared/deliveryPaidWaitingObligation';
import { derivePayableProjections } from '../shared/economicObligationProjections';
import {
  deriveEconomicFundingResponsibilityProjection,
  deriveEconomicFundingResponsibilityTotals,
} from '../shared/economicFundingResponsibilityProjections';

const service = readFileSync(
  'server/delivery/courierEarningsProjectionService.ts',
  'utf8'
);
const fundingService = readFileSync(
  'server/delivery/paidWaitingFundingResponsibilityService.ts',
  'utf8'
);
const router = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);
const card = readFileSync(
  'src/components/renda/CourierEarningsProjectionCard.tsx',
  'utf8'
);
const renda = readFileSync('src/components/tabs/RendaTab.tsx', 'utf8');

const waitingObligation = (input: { amountMinor: number; payer: 'store' | 'kyrub' }) =>
  buildDeliveryPaidWaitingCourierObligation({
    canonicalStoreId: 'store-1',
    orderId: 'order-1',
    deliveryId: 'delivery-1',
    courierId: 'courier-1',
    amountMinor: input.amountMinor,
    payer: input.payer,
    policyId: 'wait-v1',
    policyVersion: 1,
    responsibilityPolicyId: 'responsibility-v1',
    responsibilityPolicyVersion: 1,
    decidedAt: '2026-08-30T10:00:00.000Z',
  });

test('courier earnings are derived from payable projections scoped to authenticated beneficiary', () => {
  assert.match(service, /collectionGroup\('economicObligations'\)/);
  assert.match(service, /beneficiaryPrincipalId', '==', courierUserId/);
  assert.match(service, /obligation\.kind === 'courier_payable'/);
  assert.match(service, /derivePayableProjections/);
  assert.match(service, /projection\.beneficiaryPrincipalId !== courierUserId/);
});

test('paid waiting obligation participates in the canonical payable projection as its own line', () => {
  const waiting = waitingObligation({ amountMinor: 300, payer: 'store' });
  const projections = derivePayableProjections({ obligations: [waiting], settlements: [] });
  assert.equal(projections.length, 1);
  assert.equal(projections[0].obligationId, waiting.id);
  assert.equal(projections[0].amountMinor, 300);
  assert.equal(projections[0].state, 'projected');
  assert.equal(projections[0].fulfillmentId, 'delivery-1');
});

test('store-paid waiting projects explicit store funding responsibility without claiming a debit', () => {
  const waiting = waitingObligation({ amountMinor: 300, payer: 'store' });
  const projection = deriveEconomicFundingResponsibilityProjection(waiting);
  assert.ok(projection);
  assert.equal(projection.payer, 'store');
  assert.equal(projection.payerPrincipalId, 'store:store-1');
  assert.equal(projection.amountMinor, 300);
  assert.equal(projection.obligationStatus, 'pending');
  const totals = deriveEconomicFundingResponsibilityTotals([projection]);
  assert.equal(totals.pendingMinor, 300);
  assert.equal(totals.eligibleMinor, 0);
  assert.equal(totals.settledObligationMinor, 0);
});

test('Kyrub-paid waiting projects platform funding responsibility separately from store', () => {
  const waiting = waitingObligation({ amountMinor: 450, payer: 'kyrub' });
  const projection = deriveEconomicFundingResponsibilityProjection(waiting);
  assert.ok(projection);
  assert.equal(projection.payer, 'kyrub');
  assert.equal(projection.payerPrincipalId, 'kyrub:platform');
  assert.equal(projection.amountMinor, 450);
});

test('funding responsibility fails closed when payer identity conflicts with frozen policy evidence', () => {
  const waiting = waitingObligation({ amountMinor: 300, payer: 'store' });
  assert.throws(
    () => deriveEconomicFundingResponsibilityProjection({ ...waiting, payerPrincipalId: 'kyrub:platform' }),
    /ECONOMIC_FUNDING_RESPONSIBILITY_WAITING_OBLIGATION_INVALID/
  );
});

test('funding responsibility reads are payer-scoped and never execute charging or money movement', () => {
  assert.match(fundingService, /stores\/\$\{canonicalStoreId\}\/economicObligations/);
  assert.match(fundingService, /collectionGroup\('economicObligations'\)/);
  assert.match(fundingService, /sourceAuthority', '==', 'delivery_paid_waiting'/);
  assert.match(fundingService, /payerPrincipalId', '==', payerPrincipalId/);
  assert.match(fundingService, /store:\$\{canonicalStoreId\}/);
  assert.match(fundingService, /kyrub:platform/);
  assert.doesNotMatch(
    fundingService,
    /transaction\.|\.set\(|\.create\(|\.update\(|\.delete\(|charge|debit|payout|transfer|wallet|custod/i
  );
});

test('freight and paid waiting are classified by canonical source authority without netting', () => {
  assert.match(service, /CourierEarningType = 'delivery_fee' \| 'paid_waiting'/);
  assert.match(service, /sourceAuthority === 'delivery_paid_waiting'/);
  assert.match(service, /sourceAuthority === 'economic_allocation_snapshot'/);
  assert.match(service, /earningType: earningTypeFor\(obligation\)/);
  assert.match(card, /delivery_fee: 'Frete da entrega'/);
  assert.match(card, /paid_waiting: 'Espera remunerada'/);
  assert.match(card, /Frete e espera remunerada aparecem como lançamentos separados/);
});

test('projected eligible settled and reversed remain separate economic states', () => {
  assert.match(service, /projectedMinor/);
  assert.match(service, /eligibleMinor/);
  assert.match(service, /settledMinor/);
  assert.match(service, /reversedMinor/);
  assert.match(service, /projection\.state === 'projected'/);
  assert.match(service, /projection\.state === 'eligible'/);
  assert.match(service, /projection\.state === 'settled'/);
  assert.match(service, /projection\.state === 'reversed'/);
});

test('integrity errors are counted but excluded from monetary totals', () => {
  const integrityBranch = service.indexOf("projection.state === 'integrity_error'");
  const projectedBranch = service.indexOf("projection.state === 'projected'");
  assert.ok(integrityBranch >= 0);
  assert.ok(projectedBranch > integrityBranch);
  assert.match(service.slice(integrityBranch, projectedBranch), /integrityErrorCount \+= 1/);
  assert.match(service.slice(integrityBranch, projectedBranch), /continue/);
});

test('earnings projection is read-only and does not execute money movement', () => {
  assert.doesNotMatch(
    service,
    /transaction\.|\.set\(|\.create\(|\.update\(|\.delete\(|payout|transfer|wallet|custod/i
  );
});

test('earnings endpoint derives courier identity from auth instead of request input', () => {
  assert.match(router, /router\.get\('\/earnings'/);
  assert.match(router, /const courierId = await authenticatedTenantId\(request\)/);
  assert.match(router, /loadCourierEarningsProjection\(courierId\)/);
  const route = router.slice(router.indexOf("router.get('/earnings'"), router.indexOf("router.get('/:deliveryId/pickup-code'"));
  assert.doesNotMatch(route, /request\.query|request\.body|request\.params/);
});

test('Renda shows economic states without calling them balance or offering payout actions', () => {
  assert.match(renda, /CourierEarningsProjectionCard/);
  assert.match(card, /Ganhos em entregas/);
  assert.match(card, /'Previsto'/);
  assert.match(card, /'Elegível'/);
  assert.match(card, /'Liquidado'/);
  assert.match(card, /'Revertido'/);
  assert.match(card, /\/api\/delivery-opportunities\/earnings/);
  assert.doesNotMatch(card, /saldo disponível|sacar|saque|payout|transferir/i);
});

test('statement exposes lifecycle timestamps and only settled entries receive settlement evidence', () => {
  assert.match(service, /createdAt: obligation\.createdAt/);
  assert.match(service, /eligibleAt: obligation\.eligibleAt/);
  assert.match(service, /reversedAt: obligation\.reversedAt/);
  assert.match(service, /settlementProvider: settlement\?\.provider \?\? ''/);
  assert.match(service, /projection\.state === 'settled' && !settlement/);
  assert.match(card, /Extrato por entrega/);
  assert.match(card, /entry\.state === 'settled' && entry\.settlementId/);
  assert.match(card, /Liquidação confirmada por evidência autoritativa/);
  assert.match(card, /entry\.settlementProvider/);
});

test('freelance planning remains separate from canonical delivery earnings', async () => {
  const { calculateFreelanceEarningsPlan, parseFreelancePlanningMoney } = await import('../shared/freelanceEarningsPlanning');
  assert.equal(parseFreelancePlanningMoney('120,50'), 12050);
  assert.equal(parseFreelancePlanningMoney('0,01'), 1);
  assert.equal(parseFreelancePlanningMoney('1,234'), null);
  assert.equal(parseFreelancePlanningMoney('-1'), null);
  assert.deepEqual(calculateFreelanceEarningsPlan({ jobs: 8, feeMinor: 12000, costMinor: 2000 }), {
    grossMinor: 96000, totalCostMinor: 16000, netMinor: 80000,
  });
  assert.equal(calculateFreelanceEarningsPlan({ jobs: 2, feeMinor: 1000, costMinor: 2000 })?.netMinor, -2000);
  assert.equal(calculateFreelanceEarningsPlan({ jobs: 1.5, feeMinor: 100, costMinor: 0 }), null);
  assert.match(renda, /id="btn-freelance-earnings"/);
  assert.match(renda, /id="freelance-earnings-sheet"/);
  assert.match(renda, /<FreelanceEarningsPlanningCard \/>/);
  assert.match(renda, /<CourierEarningsProjectionCard \/>/);
  const freelancer = readFileSync('src/components/renda/FreelanceEarningsPlanningCard.tsx', 'utf8');
  assert.match(freelancer, /não recebimentos confirmados/);
  assert.match(freelancer, /Histórico financeiro confirmado ainda indisponível/);
  assert.doesNotMatch(freelancer, /fetch\(|localStorage|freelanceJobs|setDoc\(|addDoc\(/);
});

test('Renda activity alerts are separate and project only authenticated server claims', async () => {
  const { projectCourierActivityAlert } = await import('../shared/rendaActivityAlerts');
  const claim = {id:'d1',deliveryJobId:'d1',courierId:'a',status:'accepted',courierName:'private'};
  assert.deepEqual(projectCourierActivityAlert('d1',claim,'a'),{id:'d1',status:'accepted'});
  assert.equal(projectCourierActivityAlert('d1',claim,'b'),null);
  assert.equal(projectCourierActivityAlert('d2',claim,'a'),null);
  assert.equal(projectCourierActivityAlert('d1',{...claim,status:'available'},'a'),null);
  assert.match(renda, /RendaActivityAlertsBell kind="delivery"/);
  assert.match(renda, /RendaActivityAlertsBell kind="freelance"/);
  const bell = readFileSync('src/components/renda/RendaActivityAlertsBell.tsx','utf8');
  assert.doesNotMatch(bell,/localStorage|freelanceJobs|setDoc\(|addDoc\(/);
  assert.match(bell,/Avisos do solicitante ainda não integrados/);
  assert.match(bell,/não estão disponíveis/);
  const transport = readFileSync('server/delivery/courierActivityAlertsTransport.ts','utf8');
  assert.match(transport,/collection\('deliveryClaims'\).where\('courierId','==',uid\)/);
  assert.match(transport,/verifyIdToken\(token, true\)/);
  const { handleCourierActivityAlerts } = await import('../server/delivery/courierActivityAlertsTransport');
  let status = 0;
  const calls: string[] = [];
  const response = {setHeader(){},status(code:number){status=code;return {json(){}};}};
  const deps = {verify:async()=>({uid:'a'}),list:async(uid:string)=>{calls.push(uid);return [];}};
  await handleCourierActivityAlerts({method:'GET',headers:{}},response,deps);
  assert.equal(status,401);
  await handleCourierActivityAlerts({method:'POST',headers:{authorization:'Bearer fixture'}},response,deps);
  assert.equal(status,405);
  assert.deepEqual(calls,[]);
  await handleCourierActivityAlerts({method:'GET',headers:{authorization:'Bearer fixture'}},response,deps);
  assert.equal(status,200);
  assert.deepEqual(calls,['a']);
});

test('freelance publication and application contracts bind verified actors and preserve pending status', async () => {
  const { createFreelanceOffer, createFreelanceApplication } = await import('../shared/freelanceLifecycle');
  const now = '2026-11-27T10:00:00.000Z';
  const input = {title:'Serviço',description:'Descrição',requirements:'',paymentMinor:12345};
  const offer = createFreelanceOffer('offer-1','owner',input,now);
  assert.equal(offer.ownerUid,'owner');
  assert.equal(offer.paymentMinor,12345);
  assert.equal(offer.status,'open');
  assert.throws(()=>createFreelanceOffer('offer-1','owner',{...input,ownerUid:'other'},now),/FREELANCE_INVALID/);
  assert.throws(()=>createFreelanceOffer('offer-1','owner',{...input,paymentMinor:12.5},now),/FREELANCE_INVALID/);
  assert.throws(()=>createFreelanceApplication(offer,'owner',now),/FREELANCE_FORBIDDEN/);
  assert.deepEqual(createFreelanceApplication(offer,'worker',now),{offerId:'offer-1',ownerUid:'owner',applicantUid:'worker',status:'pending',createdAt:now});
  const service = readFileSync('server/freelance/freelanceLifecycleService.ts','utf8');
  assert.match(service,/tx.getAll\(eligibility\(actorUid\), ref\)/);
  assert.match(service,/assertApproved\(identity.data\(\), 'requester'\)/);
  assert.match(service,/assertApproved\(identity.data\(\),'freelancer'\)/);
  assert.match(service,/collection\('applications'\).doc\(actorUid\)/);
  assert.match(service,/tx.create\(applicationRef,proposed\)/);
  assert.doesNotMatch(service,/localStorage|Math.random|payout|transfer/);
});

test('freelance selection reserves exactly one candidate and only that candidate can confirm', async () => {
  const { createFreelanceOffer, createFreelanceApplication, selectFreelanceApplicant, confirmFreelanceSelection } = await import('../shared/freelanceLifecycle');
  const now = '2026-11-27T10:00:00.000Z';
  const later = '2026-11-27T10:01:00.000Z';
  const offer = createFreelanceOffer('offer-1','owner',{title:'Serviço',description:'Descrição',requirements:'',paymentMinor:12345},now);
  const worker = createFreelanceApplication(offer,'worker',now);
  const other = createFreelanceApplication(offer,'other',now);
  assert.throws(()=>selectFreelanceApplicant(offer,worker,'other',now),/FREELANCE_FORBIDDEN/);
  const selected = selectFreelanceApplicant(offer,worker,'owner',now);
  assert.equal(selected.offer.status,'selected');
  assert.equal(selected.application.status,'selected');
  assert.equal(selected.offer.paymentMinor,offer.paymentMinor);
  assert.equal(selectFreelanceApplicant(selected.offer,selected.application,'owner',later).changed,false);
  assert.throws(()=>selectFreelanceApplicant(selected.offer,other,'owner',later),/FREELANCE_CONFLICT/);
  assert.throws(()=>createFreelanceApplication(selected.offer,'third',later),/FREELANCE_FORBIDDEN/);
  assert.throws(()=>confirmFreelanceSelection(selected.offer,selected.application,'owner',true,later),/FREELANCE_FORBIDDEN/);
  assert.throws(()=>confirmFreelanceSelection(selected.offer,other,'other',true,later),/FREELANCE_FORBIDDEN/);
  assert.throws(()=>confirmFreelanceSelection(selected.offer,selected.application,'worker',false,later),/FREELANCE_FORBIDDEN/);
  assert.throws(()=>confirmFreelanceSelection(offer,worker,'worker',true,later),/FREELANCE_FORBIDDEN/);
  const contracted = confirmFreelanceSelection(selected.offer,selected.application,'worker',true,later);
  assert.equal(contracted.offer.status,'contracted');
  assert.equal(contracted.application.status,'contracted');
  assert.equal(contracted.offer.paymentMinor,12345);
  assert.equal(contracted.offer.contractedAt,contracted.application.contractedAt);
  assert.equal(confirmFreelanceSelection(contracted.offer,contracted.application,'worker',true,later).changed,false);
  assert.equal(offer.status,'open');
  assert.equal(worker.status,'pending');
  const service = readFileSync('server/freelance/freelanceLifecycleService.ts','utf8');
  assert.match(service,/tx.getAll\(eligibility\(actorUid\),eligibility\(applicantUid\),offerRef,applicationRef\)/);
  assert.match(service,/tx.get\(eligibility\(offer.ownerUid\)\)/);
  assert.match(service,/offer.selectedApplicantUid !== actorUid/);
  assert.match(service,/tx.update\(offerRef,\{status:result.offer.status,contractedAt/);
  assert.match(service,/tx.update\(applicationRef,\{status:result.application.status,contractedAt/);
  assert.doesNotMatch(service,/economicObligations|economicSettlements|wallet|payout/);
});

test('freelance release, withdrawal, cancellation and bilateral completion remain operational only',async()=>{
  const m=await import('../shared/freelanceLifecycle');
  const now='2026-11-27T10:00:00.000Z', later='2026-11-27T10:01:00.000Z';
  const offer=m.createFreelanceOffer('offer-1','owner',{title:'Serviço',description:'Descrição',requirements:'',paymentMinor:12345},now);
  const worker=m.createFreelanceApplication(offer,'worker',now), other=m.createFreelanceApplication(offer,'other',now);
  const selected=m.selectFreelanceApplicant(offer,worker,'owner',now);
  assert.throws(()=>m.releaseFreelanceSelection(selected.offer,selected.application,'other',true,later),/FREELANCE_FORBIDDEN/);
  const released=m.releaseFreelanceSelection(selected.offer,selected.application,'worker',true,later);
  assert.equal(released.offer.status,'open');assert.equal(released.offer.selectedApplicantUid,undefined);
  assert.equal(released.application.status,'released');
  assert.equal(m.releaseFreelanceSelection(released.offer,released.application,'worker',true,later).changed,false);
  assert.throws(()=>m.selectFreelanceApplicant(released.offer,released.application,'owner',later),/FREELANCE_CONFLICT/);
  assert.equal(m.selectFreelanceApplicant(released.offer,other,'owner',later).offer.selectedApplicantUid,'other');
  assert.equal(m.withdrawFreelanceApplication(offer,other,'other',true,later).application.status,'withdrawn');
  assert.throws(()=>m.withdrawFreelanceApplication(offer,other,'owner',true,later),/FREELANCE_FORBIDDEN/);
  assert.equal(m.cancelOpenFreelanceOffer(offer,'owner',true,later).status,'cancelled');
  assert.throws(()=>m.cancelOpenFreelanceOffer(selected.offer,'owner',true,later),/FREELANCE_CONFLICT/);
  const contracted=m.confirmFreelanceSelection(selected.offer,selected.application,'worker',true,later);
  assert.throws(()=>m.releaseFreelanceSelection(contracted.offer,contracted.application,'worker',true,later),/FREELANCE_CONFLICT/);
  assert.throws(()=>m.advanceFreelanceExecution(contracted.offer,contracted.application,'owner','confirm_completion',true,later),/FREELANCE_CONFLICT/);
  assert.throws(()=>m.advanceFreelanceExecution(contracted.offer,contracted.application,'owner','start',true,later),/FREELANCE_FORBIDDEN/);
  const started=m.advanceFreelanceExecution(contracted.offer,contracted.application,'worker','start',true,later);
  const requested=m.advanceFreelanceExecution(started.offer,started.application,'worker','request_completion',true,later);
  assert.equal(requested.offer.status,'completion_requested');
  assert.throws(()=>m.advanceFreelanceExecution(requested.offer,requested.application,'worker','confirm_completion',true,later),/FREELANCE_FORBIDDEN/);
  const done=m.advanceFreelanceExecution(requested.offer,requested.application,'owner','confirm_completion',true,later);
  assert.equal(done.offer.status,'completed');assert.equal(done.application.status,'completed');
  assert.equal(done.offer.paymentMinor,12345);
  assert.equal(m.advanceFreelanceExecution(done.offer,done.application,'owner','confirm_completion',true,later).changed,false);
  assert.equal(m.advanceFreelanceExecution(started.offer,started.application,'worker','start',true,later).changed,false);
  assert.throws(()=>m.advanceFreelanceExecution(requested.offer,requested.application,'owner','confirm_completion',false,later),/FREELANCE_FORBIDDEN/);
  const source=readFileSync('server/freelance/freelanceLifecycleService.ts','utf8');
  assert.match(source,/selectedApplicantUid:FieldValue.delete\(\)/);
  assert.match(source,/tx.update\(applicationRef,\{status:result.application.status,\[at\]/);
  assert.doesNotMatch(source,/economicObligations|economicSettlements|wallet|payout/);
});

test('post-contract freelance occurrence freezes execution for review without assigning cost',async()=>{
 const m=await import('../shared/freelanceLifecycle');
 const now='2026-11-27T10:00:00.000Z', later='2026-11-27T10:01:00.000Z';
 const o=m.createFreelanceOffer('offer-1','owner',{title:'Serviço',description:'Descrição',requirements:'',paymentMinor:12345},now);
 const a=m.createFreelanceApplication(o,'worker',now);
 const selected=m.selectFreelanceApplicant(o,a,'owner',now);
 const c=m.confirmFreelanceSelection(selected.offer,selected.application,'worker',true,later);
 assert.throws(()=>m.openFreelanceOccurrence(c.offer,c.application,'third','service_disputed',true,later),/FREELANCE_FORBIDDEN/);
 assert.throws(()=>m.openFreelanceOccurrence(c.offer,c.application,'owner','arbitrary',true,later),/FREELANCE_INVALID/);
 const start=m.advanceFreelanceExecution(c.offer,c.application,'worker','start',true,later);
 const incident=m.openFreelanceOccurrence(start.offer,start.application,'worker','cancellation_requested',true,later);
 assert.equal(incident.priorStatus,'in_progress');
 assert.equal(incident.status,'awaiting_review');
 assert.throws(()=>m.recordFreelanceOccurrenceResponse(incident,'worker','agree',true,later),/FREELANCE_FORBIDDEN/);
 const answer=m.recordFreelanceOccurrenceResponse(incident,'owner','agree',true,later);
 assert.equal(answer.status,'awaiting_review');
 assert.equal(answer.response?.position,'agree');
 assert.equal(m.recordFreelanceOccurrenceResponse(answer,'owner','agree',true,later),answer);
 assert.throws(()=>m.recordFreelanceOccurrenceResponse(answer,'owner','disagree',true,later),/FREELANCE_CONFLICT/);
 assert.throws(()=>m.advanceFreelanceExecution({...start.offer,status:'under_review',occurrenceId:incident.id},{...start.application,status:'under_review',occurrenceId:incident.id},'worker','request_completion',true,later),/FREELANCE_CONFLICT/);
 assert.equal(start.offer.paymentMinor,12345);
 const source=readFileSync('server/freelance/freelanceLifecycleService.ts','utf8');
 assert.match(source,/tx.create\(occurrenceRef,result\)/);
 assert.match(source,/tx.update\(offerRef,\{status:'under_review'/);
 assert.match(source,/tx.update\(applicationRef,\{status:'under_review'/);
 assert.doesNotMatch(source,/economicObligations|economicSettlements|wallet|payout/);
});

test('freelance administrative decision preserves evidence, separates finance and permits a later occurrence',async()=>{
 const m=await import('../shared/freelanceLifecycle');
 const now='2026-11-27T10:00:00.000Z',later='2026-11-27T10:01:00.000Z';
 const o=m.createFreelanceOffer('offer-1','owner',{title:'Serviço',description:'Descrição',requirements:'',paymentMinor:12345},now);
 const s=m.selectFreelanceApplicant(o,m.createFreelanceApplication(o,'worker',now),'owner',now);
 const c=m.confirmFreelanceSelection(s.offer,s.application,'worker',true,later);
 const incident=m.openFreelanceOccurrence(c.offer,c.application,'worker','service_disputed',true,later,'review-1');
 const offer={...c.offer,status:'under_review' as const,occurrenceId:incident.id};
 const app={...c.application,status:'under_review' as const,occurrenceId:incident.id};
 assert.throws(()=>m.resolveFreelanceOccurrence(offer,app,incident,'owner','cancel','Motivo fundamentado',true,later),/FREELANCE_FORBIDDEN/);
 assert.throws(()=>m.resolveFreelanceOccurrence(offer,app,incident,'admin','resume','Motivo fundamentado',true,later),/FREELANCE_CONFLICT/);
 const agreed=m.recordFreelanceOccurrenceResponse(incident,'owner','agree',true,later);
 const resumed=m.resolveFreelanceOccurrence(offer,app,agreed,'admin','resume','Motivo fundamentado',true,later);
 assert.equal(resumed.offer.status,'contracted');assert.equal(resumed.offer.occurrenceId,undefined);
 assert.equal(resumed.occurrence.status,'resolved');
 assert.equal(resumed.occurrence.decision?.financialReview,'not_determined');
 assert.equal(m.openFreelanceOccurrence(resumed.offer,resumed.application,'owner','cancellation_requested',true,later,'review-2').id,'review-2');
 const cancelled=m.resolveFreelanceOccurrence(offer,app,incident,'admin','cancel','Motivo fundamentado',true,later);
 assert.equal(cancelled.offer.status,'cancelled');assert.equal(cancelled.application.status,'cancelled');
 assert.equal(cancelled.offer.paymentMinor,12345);
 assert.equal(cancelled.occurrence.decision?.financialReview,'pending');
 assert.equal(m.resolveFreelanceOccurrence(cancelled.offer,cancelled.application,cancelled.occurrence,'admin','cancel','Motivo fundamentado',true,later).changed,false);
 const source=readFileSync('server/admin/freelanceReviewService.ts','utf8');
 assert.match(source,/requireKyrubSessionMfa\(authorization,'administrative',300\)/);
 assert.match(source,/role.role!=='super_admin'/);
 assert.match(source,/assertRole\(uid,role.data\(\)\)/);
 assert.match(source,/tx.create\(auditRef/);
 assert.doesNotMatch(source,/economicObligations|economicSettlements|wallet|payout/);
});
