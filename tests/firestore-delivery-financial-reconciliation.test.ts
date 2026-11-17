import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../server/firebaseAdmin';
import { buildEconomicAllocationSnapshot } from '../shared/economicFeesSubsidies';
import {
  proposeSupervisedCustodyTransfer,
  acknowledgeSupervisedCustodyTransfer,
  attestSupervisedCustodyTransfer,
} from '../server/delivery/deliverySupervisedTransferService';
import {
  previewCourierRemunerationReconciliation,
  proposeCourierRemunerationReconciliation,
  acceptCourierRemunerationTerms,
  approveCourierRemunerationReconciliation,
} from '../server/delivery/deliveryFinancialReconciliationService';
import { executeSupervisedDeliveryReassignment } from '../server/delivery/deliveryCustodyExecutionService';
import {
  markCourierArrivedAtCustomer,
  confirmBuyerReceivedDelivery,
} from '../server/delivery/deliveryCustomerHandoffService';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('DELIVERY_FINANCIAL_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';
process.env.GCLOUD_PROJECT = 'kyrub-security-test';

const operator = 'finance_preparer';
const reviewer = 'finance_reviewer';
const executor = 'finance_independent_executor';
const original = 'finance_original';
const recipient = 'finance_recipient';
const storeId = 'finance_store';
const canonicalStoreId = 'finance_canonical';
const orderPrefix = 'finance_order';
const fee = 1200;

const seed = async (deliveryId: string, capture: boolean) => {
  const orderId = `${orderPrefix}_${deliveryId}`;
  const at = Timestamp.now();
  const allocation = buildEconomicAllocationSnapshot({
    merchandiseGrossMinor:4000, customerPaidMinor:5200, deliveryFeeMinor:fee,
  });
  const paymentId = 'payment_' + deliveryId;
  const captureId = 'payment:capture:' + paymentId;
  await Promise.all([
    adminDb.doc(`kyrub_admin/control_plane/admins/${operator}`).set({
      uid:operator,role:'operations',status:'active',
    }),
    adminDb.doc(`kyrub_admin/control_plane/admins/${reviewer}`).set({
      uid:reviewer,role:'compliance',status:'active',
    }),
    adminDb.doc(`kyrub_admin/control_plane/admins/${executor}`).set({
      uid:executor,role:'super_admin',status:'active',
    }),
    adminDb.doc(`identity_verifications/${recipient}`).set({
      uid:recipient,status:'approved',approvedProfiles:['bicycle_courier'],
    }),
    adminDb.doc(`courierComplianceHolds/${original}`).set({
      userId:original,active:true,decision:'revoked',
    }),
    adminDb.doc(`deliveryComplianceIncidents/${deliveryId}`).set({
      deliveryId,source:'motofrete_qualification_revoked',
      status:'awaiting_supervised_handoff',courierId:original,storeId,
    }),
    adminDb.doc(`hub/renda/deliveries/${deliveryId}`).set({
      id:deliveryId,source:'kyrub-order',storeId,
      sourceOrderId:orderId,buyerId:'finance_buyer',acceptedBy:original,
      status:'delivering',vehicleType:'motorcycle',collectedAt:at,
      cargo:{kind:'parcel',weightKg:2,lengthCm:20,widthCm:15,heightCm:10,
        requiresSpecialHandling:false},
    }),
    adminDb.doc(`deliveryClaims/${deliveryId}`).set({
      deliveryJobId:deliveryId,courierId:original,vehicleType:'motorcycle',
      status:'delivering',collectedAt:at,
    }),
    adminDb.doc(`tenants/${storeId}`).set({canonicalStoreId}),
    adminDb.doc(`artifacts/${storeId}/public/data/customerOrders/${orderId}`).set({
      buyerId:'finance_buyer',fulfillmentType:'delivery',
      deliveryProvider:'kyrub',status:'out_for_delivery',
    }),
    ...(capture ? [adminDb.doc(`stores/${canonicalStoreId}/economicLedger/${captureId}`).set({
      schemaVersion:1,id:captureId,storeId:canonicalStoreId,
      kind:'payment_capture',currency:'BRL',amountMinor:5200,
      paymentId,paymentIntentId:'intent_'+paymentId,orderId,buyerId:'finance_buyer',
      paymentContext:'marketplace',paymentMethod:'pix',
      provider:'mercado_pago',providerPaymentId:'provider_'+paymentId,
      providerEventId:'event_'+paymentId,sourceAuthority:'provider_webhook',
      reversalOfEntryId:'',occurredAt:'2026-11-16T17:00:00.000Z',
      economicAllocation:allocation,
    })] : []),
  ]);
  await proposeSupervisedCustodyTransfer({
    deliveryId,operatorId:operator,toCourierId:recipient,
    targetVehicle:'bicycle',reason:'Transição física supervisionada por segurança.',
  });
  await acknowledgeSupervisedCustodyTransfer({
    deliveryId,actorId:original,statement:'physically_handed_over',
  });
  await acknowledgeSupervisedCustodyTransfer({
    deliveryId,actorId:recipient,statement:'physically_received',
  });
  await attestSupervisedCustodyTransfer({
    deliveryId,supervisorId:operator,
    note:'Dois participantes confirmados com supervisão registrada.',
  });
  return { paymentId, captureId };
};

test('one captured delivery fee yields exact consented terms, with no custody or payable changes', async () => {
  const deliveryId='finance_reconciliation_valid';
  await seed(deliveryId,true);
  const pendingRef=adminDb.doc(`stores/${canonicalStoreId}/economicObligations/pending_waiting_test`);
  await pendingRef.set({
    id:'pending_waiting_test',kind:'courier_payable',fulfillmentId:deliveryId,
    beneficiaryPrincipalId:original,status:'pending',
    sourceAuthority:'delivery_paid_waiting',amountMinor:75,
  });
  const preview=await previewCourierRemunerationReconciliation({
    deliveryId,operatorId:operator,
  });
  assert.equal(preview.totalMinor,fee);
  assert.equal(preview.currency,'BRL');
  assert.equal(preview.unresolvedObligationCount,1);
  await assert.rejects(proposeCourierRemunerationReconciliation({
    deliveryId,operatorId:operator,outgoingMinor:500,incomingMinor:800,
    reason:'Valor incorreto, deve ser recusado.',
  }),/DELIVERY_FINANCIAL_RECONCILIATION_SPLIT_INVALID/);
  const proposal={
    deliveryId,operatorId:operator,outgoingMinor:500,incomingMinor:700,
    reason:'Divisão de remuneração auditada entre duas etapas físicas.',
  };
  assert.equal((await proposeCourierRemunerationReconciliation(proposal)).totalMinor,fee);
  assert.equal((await proposeCourierRemunerationReconciliation(proposal)).totalMinor,fee);
  await assert.rejects(acceptCourierRemunerationTerms({
    deliveryId,actorId:'stranger',
  }),/DELIVERY_FINANCIAL_RECONCILIATION_FORBIDDEN/);
  await assert.rejects(approveCourierRemunerationReconciliation({
    deliveryId,reviewerId:reviewer,
    reason:'Ainda não existem os dois aceites financeiros.',
  }),/DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT/);
  assert.equal((await acceptCourierRemunerationTerms({
    deliveryId,actorId:original,
  })).status,'awaiting_courier_terms');
  assert.equal((await acceptCourierRemunerationTerms({
    deliveryId,actorId:original,
  })).status,'awaiting_courier_terms');
  assert.equal((await acceptCourierRemunerationTerms({
    deliveryId,actorId:recipient,
  })).status,'awaiting_independent_review');
  await assert.rejects(approveCourierRemunerationReconciliation({
    deliveryId,reviewerId:operator,
    reason:'O preparador não pode aprovar a própria divisão.',
  }),/DELIVERY_FINANCIAL_RECONCILIATION_FORBIDDEN/);
  const approved=await approveCourierRemunerationReconciliation({
    deliveryId,reviewerId:reviewer,
    reason:'Fonte capturada e duas parcelas conferidas independentemente.',
  });
  assert.equal(approved.status,'approved_pending_manual_execution');
  assert.equal((await approveCourierRemunerationReconciliation({
    deliveryId,reviewerId:reviewer,
    reason:'Fonte capturada e duas parcelas conferidas independentemente.',
  })).status,approved.status);
  const [doc,claim,delivery,completion,obligations,events] = await Promise.all([
    adminDb.doc(`deliveryFinancialReconciliations/${deliveryId}`).get(),
    adminDb.doc(`deliveryClaims/${deliveryId}`).get(),
    adminDb.doc(`hub/renda/deliveries/${deliveryId}`).get(),
    adminDb.doc(`deliveryCompletions/${deliveryId}`).get(),
    adminDb.collection(`stores/${canonicalStoreId}/economicObligations`)
      .where('fulfillmentId','==',deliveryId).get(),
    adminDb.collection('deliveryFinancialReconciliationEvents')
      .where('deliveryId','==',deliveryId).get(),
  ]);
  assert.equal(doc.data()?.outgoingMinor,500);
  assert.equal(doc.data()?.incomingMinor,700);
  assert.equal(doc.data()?.settlementStatus,'blocked_pending_manual_execution');
  assert.equal(doc.data()?.unresolvedObligationIds.length,1);
  assert.equal(claim.data()?.courierId,original);
  assert.equal(delivery.data()?.acceptedBy,original);
  assert.equal(delivery.data()?.status,'delivering');
  assert.equal(completion.exists,false);
  assert.equal(obligations.size,1); // old waiting obligation is untouched
  assert.equal(obligations.docs[0].data().status,'pending');
  assert.equal(events.size,4);
});

test('no captured payment or already eligible obligation prevents any proposed split', async () => {
  const missing='finance_reconciliation_missing';
  await seed(missing,false);
  await assert.rejects(previewCourierRemunerationReconciliation({
    deliveryId:missing,operatorId:operator,
  }),/DELIVERY_FINANCIAL_RECONCILIATION_SOURCE_UNAVAILABLE/);
  const settled='finance_reconciliation_settled';
  await seed(settled,true);
  await adminDb.doc(`stores/${canonicalStoreId}/economicObligations/eligible_settlement_test`).set({
    id:'eligible_settlement_test',kind:'courier_payable',fulfillmentId:settled,
    status:'eligible',amountMinor:1200,beneficiaryPrincipalId:original,
  });
  await assert.rejects(previewCourierRemunerationReconciliation({
    deliveryId:settled,operatorId:operator,
  }),/DELIVERY_FINANCIAL_RECONCILIATION_OBLIGATION_CONFLICT/);
});

test('approval rechecks the authoritative payment source after both signatures', async () => {
  const deliveryId='finance_reconciliation_source_changed';
  const refs=await seed(deliveryId,true);
  await proposeCourierRemunerationReconciliation({
    deliveryId,operatorId:operator,outgoingMinor:600,incomingMinor:600,
    reason:'Divisão sujeita a revalidação da autoridade financeira.',
  });
  await acceptCourierRemunerationTerms({deliveryId,actorId:original});
  await acceptCourierRemunerationTerms({deliveryId,actorId:recipient});
  await adminDb.doc(`stores/${canonicalStoreId}/economicLedger/${refs.captureId}`)
    .update({'economicAllocation.deliveryFeeMinor':1100});
  await assert.rejects(approveCourierRemunerationReconciliation({
    deliveryId,reviewerId:reviewer,
    reason:'Validação deve rejeitar alterações na fonte canônica.',
  }));
  assert.equal((await adminDb.doc(`deliveryFinancialReconciliations/${deliveryId}`).get())
    .data()?.status,'awaiting_independent_review');
});

const fullyReviewed = async (deliveryId: string) => {
  await proposeCourierRemunerationReconciliation({
    deliveryId,operatorId:operator,outgoingMinor:500,incomingMinor:700,
    reason:'Divisão contratual verificada e confirmada no controle operacional.',
  });
  await acceptCourierRemunerationTerms({deliveryId,actorId:original});
  await acceptCourierRemunerationTerms({deliveryId,actorId:recipient});
  await approveCourierRemunerationReconciliation({
    deliveryId,reviewerId:reviewer,
    reason:'Origem e dupla concordância conferidas independentemente.',
  });
};
test('independent executor safely reassigns GPS and claim; only buyer confirms exact split eligibility', async () => {
  const deliveryId='finance_reassignment_executed';
  await seed(deliveryId,true);
  await fullyReviewed(deliveryId);
  await assert.rejects(executeSupervisedDeliveryReassignment({
    deliveryId,executorId:operator,
    reason:'Operador original não pode executar a própria transferência.',
  }),/DELIVERY_CUSTODY_EXECUTION_FORBIDDEN/);
  await assert.rejects(executeSupervisedDeliveryReassignment({
    deliveryId,executorId:reviewer,
    reason:'Revisor financeiro não pode executar sua própria decisão.',
  }),/DELIVERY_CUSTODY_EXECUTION_FORBIDDEN/);
  const execution={
    deliveryId,executorId:executor,
    reason:'Inspeção final independente e reinício do rastreamento autorizado.',
  };
  const applied=await executeSupervisedDeliveryReassignment(execution);
  assert.equal(applied.recipientId,recipient);
  assert.equal(applied.status,'recipient_awaiting_delivery');
  assert.deepEqual(await executeSupervisedDeliveryReassignment(execution),applied);

  const [claim,delivery,tracking,transfer,finance,preCompletion,prePayables] = await Promise.all([
    adminDb.doc(`deliveryClaims/${deliveryId}`).get(),
    adminDb.doc(`hub/renda/deliveries/${deliveryId}`).get(),
    adminDb.doc(`deliveryTracking/${deliveryId}`).get(),
    adminDb.doc(`deliveryCustodyTransfers/${deliveryId}`).get(),
    adminDb.doc(`deliveryFinancialReconciliations/${deliveryId}`).get(),
    adminDb.doc(`deliveryCompletions/${deliveryId}`).get(),
    adminDb.collection(`stores/${canonicalStoreId}/economicObligations`)
      .where('fulfillmentId','==',deliveryId).get(),
  ]);
  assert.equal(claim.data()?.courierId,recipient);
  assert.equal(claim.data()?.previousCourierId,original);
  assert.equal(delivery.data()?.acceptedBy,recipient);
  assert.equal(delivery.data()?.previousCourierId,original);
  assert.equal(delivery.data()?.vehicleType,'bicycle');
  assert.equal(delivery.data()?.status,'delivering');
  assert.equal(tracking.data()?.active,false);
  assert.equal(tracking.data()?.latitude,undefined);
  assert.equal(tracking.data()?.longitude,undefined);
  assert.equal(tracking.data()?.courierId,recipient);
  assert.equal(transfer.data()?.status,'operational_reassigned');
  assert.equal(finance.data()?.status,'operational_reassigned_awaiting_buyer_confirmation');
  assert.equal(preCompletion.exists,false);
  assert.equal(prePayables.empty,true);
  await assert.rejects(confirmBuyerReceivedDelivery({
    deliveryId,buyerId:'finance_buyer',
  }),/ainda não informou a chegada ao cliente/);
  await adminDb.doc(`deliveryTracking/${deliveryId}`).update({
    active:true,courierId:recipient,latitude:-23.58,longitude:-46.62,
    accuracy:9,updatedAt:Timestamp.now(),
  });
  await assert.rejects(markCourierArrivedAtCustomer({
    deliveryId,courierId:original,
  }),/Somente o entregador responsável/);
  assert.equal((await markCourierArrivedAtCustomer({
    deliveryId,courierId:recipient,
  })).status,'awaiting_buyer_confirmation');
  const result=await confirmBuyerReceivedDelivery({deliveryId,buyerId:'finance_buyer'});
  assert.equal(result.status,'done');
  assert.equal(result.courierPayableEligible,true);
  assert.equal((await confirmBuyerReceivedDelivery({deliveryId,buyerId:'finance_buyer'})).status,'done');
  const [payables,completion,completedOrder] = await Promise.all([
    adminDb.collection(`stores/${canonicalStoreId}/economicObligations`)
      .where('fulfillmentId','==',deliveryId).get(),
    adminDb.doc(`deliveryCompletions/${deliveryId}`).get(),
    adminDb.doc(`artifacts/${storeId}/public/data/customerOrders/finance_order_${deliveryId}`).get(),
  ]);
  assert.equal(payables.size,2);
  const amounts=payables.docs.map(doc=>({
    id:doc.data().beneficiaryPrincipalId,
    amount:doc.data().amountMinor,
    status:doc.data().status,
    funding:doc.data().funding.customerMinor,
  })).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(amounts,[
    {id:original,amount:500,status:'eligible',funding:500},
    {id:recipient,amount:700,status:'eligible',funding:700},
  ].sort((a,b)=>a.id.localeCompare(b.id)));
  assert.equal(completion.data()?.courierId,recipient);
  assert.equal(completedOrder.data()?.status,'completed');
  // No payment provider transfer or economic settlement record is created.
  const settlements=await adminDb.collection(`stores/${canonicalStoreId}/economicSettlements`)
    .get();
  assert.equal(settlements.empty,true);
});

test('outstanding waiting remuneration blocks executor without changing the claim or credited income', async () => {
  const deliveryId='finance_reassignment_waiting_hold';
  await seed(deliveryId,true);
  const path=`stores/${canonicalStoreId}/economicObligations/waiting_${deliveryId}`;
  await adminDb.doc(path).set({
    id:'waiting_'+deliveryId,kind:'courier_payable',
    status:'pending',sourceAuthority:'delivery_paid_waiting',
    beneficiaryPrincipalId:original,fulfillmentId:deliveryId,
    amountMinor:300,
  });
  await fullyReviewed(deliveryId);
  await assert.rejects(executeSupervisedDeliveryReassignment({
    deliveryId,executorId:executor,
    reason:'Esperas não reconciliadas devem impedir transferência financeira.',
  }),/DELIVERY_CUSTODY_EXECUTION_OUTSTANDING_OBLIGATIONS/);
  assert.equal((await adminDb.doc(`deliveryClaims/${deliveryId}`).get()).data()?.courierId,original);
  assert.equal((await adminDb.doc(path).get()).data()?.status,'pending');
});

test('replacing the authorized capture after approval blocks execution', async () => {
  const deliveryId='finance_reassignment_source_modified';
  const {captureId}=await seed(deliveryId,true);
  await fullyReviewed(deliveryId);
  await adminDb.doc(`stores/${canonicalStoreId}/economicLedger/${captureId}`)
    .update({'economicAllocation.deliveryFeeMinor':1100});
  await assert.rejects(executeSupervisedDeliveryReassignment({
    deliveryId,executorId:executor,
    reason:'Não é permitido executar com fonte de remuneração alterada.',
  }));
  assert.equal((await adminDb.doc(`deliveryClaims/${deliveryId}`).get()).data()?.courierId,original);
});
