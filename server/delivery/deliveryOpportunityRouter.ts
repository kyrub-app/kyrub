import { createHash } from 'node:crypto';
import {
  assessDeliveryCargo,
  courierVehicleDocumentEligibility,
  isCourierVehicleType,
  type CourierVehicleType,
} from '../../shared/deliveryVehicleCompatibility.js';
import { Router, type Request, type Response } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { buildDeliveryCustomerDestinationSnapshot } from '../../shared/deliveryCustomerDestination.js';
import { adminAuth, adminDb } from '../firebaseAdmin';
import {
  confirmSecureCourierPickupAndStartRoute,
  readOrCreateDeliveryPickupCodeForStore,
} from './deliveryPickupHandoffService.js';
import {
  confirmBuyerReceivedDelivery,
  markCourierArrivedAtCustomer,
} from './deliveryCustomerHandoffService.js';
import { loadCourierEarningsProjection } from './courierEarningsProjectionService.js';
import {
  DELIVERY_PAID_WAITING_POLICY_PATH,
  loadAuthoritativeDeliveryPaidWaitingPolicy,
} from './deliveryPaidWaitingPolicyService.js';
import {
  DELIVERY_RESPONSIBILITY_POLICY_PATH,
  loadAuthoritativeDeliveryResponsibilityPolicy,
} from './deliveryResponsibilityPolicyService.js';
import { materializeDeliveryResponsibilityAndWaitingDecision } from './deliveryResponsibilityDecisionOrchestrator.js';
import { buildDeliveryDestinationResolutionSnapshotFields } from './deliveryDestinationResolutionSnapshotService.js';
import { buildPublicKyrubDeliveryOffer } from './deliveryPublicOfferProjection.js';
import { reviewMotofreteWithAudit, MOTO_CHECKLIST } from '../identity/motofreteReviewService.js';
import { resolveDeliveryComplianceIncident } from './deliveryComplianceIncidentService.js';
import {
  submitCourierSupportTicket,
  respondToCourierSupportTicket,
} from './deliverySupportTicketService.js';
import {
  declareRecipientContactAttempt,
  requestRecipientAbsenceReview,
} from './deliveryRecipientAbsenceEvidenceService.js';
import {
  authorizeRecipientAbsenceReturn,
  revokeRecipientAbsenceReturn,
  declareCourierReturnAtStore,
  confirmStoreReceivedReturnedDelivery,
} from './deliveryReturnToStoreService.js';
import { previewDeliveryReturnEconomicReconciliation } from './deliveryReturnEconomicReviewService.js';
import { verifyIndependentReturnDistance } from './deliveryReturnRouteVerificationService.js';
import {
  RETURN_TARIFF_CONFIG_PATH, publishedReturnTariffOffer,
  validateServerTariffOffer, acceptServerReturnTariffOffer,
} from './deliveryReturnTariffContractService.js';
import { getDeliveryReturnLiabilityReview, proposeDeliveryReturnLiabilityReview, reviewDeliveryReturnLiability } from './deliveryReturnLiabilityReviewService.js';
import { executeSupervisedDeliveryReassignment } from './deliveryCustodyExecutionService.js';
import {
  proposeSupervisedCustodyTransfer,
  acknowledgeSupervisedCustodyTransfer,
  attestSupervisedCustodyTransfer,
} from './deliverySupervisedTransferService.js';
import {
  proposeCourierRemunerationReconciliation,
  acceptCourierRemunerationTerms,
  approveCourierRemunerationReconciliation,
  previewCourierRemunerationReconciliation,
} from './deliveryFinancialReconciliationService.js';
import {
  DELIVERY_CUSTOMER_ARRIVAL_POLICY_PATH,
  loadAuthoritativeDeliveryCustomerArrivalPolicy,
} from './deliveryCustomerArrivalPolicyService.js';

const DELIVERY_COLLECTION = 'hub/renda/deliveries';
const PUBLIC_DELIVERY_OFFERS_COLLECTION = 'hub/renda/deliveryOffers';
const DELIVERY_CLAIM_COLLECTION = 'deliveryClaims';
const DELIVERY_ESCALATION_QUEUE = 'deliveryEscalationQueue';
const ESCALATION_COLLECTION = 'adminLogisticsEscalations';
const ESCALATION_DELAY_MS = 3 * 60 * 1000;

type DeliveryOperationalStatus = 'accepted' | 'delivering' | 'done';

interface AuthenticatedActor {
  uid: string;
  name: string;
}

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
};

const authenticatedToken = async (request: Request): Promise<DecodedIdToken> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  return adminAuth.verifyIdToken(token, true);
};

const authenticatedTenantId = async (request: Request): Promise<string> =>
  (await authenticatedToken(request)).uid;

const authenticatedActor = async (
  request: Request
): Promise<AuthenticatedActor> => {
  const decoded = await authenticatedToken(request);
  return {
    uid: decoded.uid,
    name:
      clean(decoded.name) ||
      clean(decoded.email) ||
      'Entregador Kyrub',
  };
};

const cronAuthorized = (request: Request): boolean => {
  const expected = process.env.INTEGRATION_CRON_SECRET?.trim();
  if (!expected) return false;
  return request.get('x-cron-secret')?.trim() === expected || bearerToken(request) === expected;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finite = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const orderPath = (tenantId: string, orderId: string): string =>
  `artifacts/${tenantId}/public/data/customerOrders/${orderId}`;

const deliveryJobId = (tenantId: string, orderId: string): string =>
  `order-${createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex')}`;

const deliveryPath = (deliveryId: string): string =>
  `${DELIVERY_COLLECTION}/${deliveryId}`;
const publicOfferPath = (deliveryId: string): string =>
  `${PUBLIC_DELIVERY_OFFERS_COLLECTION}/${deliveryId}`;
const claimPath = (deliveryId: string): string =>
  `${DELIVERY_CLAIM_COLLECTION}/${deliveryId}`;
const escalationQueuePath = (deliveryId: string): string =>
  `${DELIVERY_ESCALATION_QUEUE}/${deliveryId}`;

const validateDeliveryId = (deliveryId: string): string => {
  const normalized = deliveryId.trim();
  if (!normalized || !/^[a-zA-Z0-9_-]{1,128}$/.test(normalized)) {
    throw new Error('A entrega não foi identificada.');
  }
  return normalized;
};

const parseOperationalStatus = (value: unknown): DeliveryOperationalStatus => {
  if (value === 'accepted' || value === 'delivering' || value === 'done') {
    return value;
  }
  throw new Error('Status de entrega inválido.');
};

const errorResponse = (response: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (message === 'DELIVERY_FINANCIAL_RECONCILIATION_FORBIDDEN') {
    response.status(403).json({ code: message, error: 'A conciliação exige um participante autorizado ou revisor administrativo independente.' });
    return;
  }
  if (message === 'DELIVERY_FINANCIAL_RECONCILIATION_INVALID'
    || message === 'DELIVERY_FINANCIAL_RECONCILIATION_SPLIT_INVALID') {
    response.status(400).json({ code: message, error: 'A divisão deve ser composta por valores inteiros em centavos que totalizem a remuneração oficial.' });
    return;
  }
  if (message.startsWith('DELIVERY_FINANCIAL_RECONCILIATION_')) {
    response.status(409).json({ code: message,
      error: 'A fonte financeira está indisponível, mudou ou há uma obrigação incompatível. Atualize a conciliação sem liberar pagamentos.' });
    return;
  }
  if (message === 'DELIVERY_CUSTODY_EXECUTION_FORBIDDEN') {
    response.status(403).json({code:message,error:'A execução exige Super Admin independente de autores e beneficiários.'});
    return;
  }
  if (message === 'DELIVERY_CUSTODY_EXECUTION_INVALID') {
    response.status(400).json({code:message,error:'Informe uma justificativa válida para a execução.'});
    return;
  }
  if (message.startsWith('DELIVERY_CUSTODY_EXECUTION_')) {
    response.status(409).json({code:message,error:'A entrega, habilitação ou fonte financeira mudou, ou há obrigações já existentes. Não foi feita reatribuição.'});
    return;
  }
  if (message === 'CUSTODY_TRANSFER_SETTLEMENT_HOLD') {
    response.status(409).json({
      code: message,
      error: 'Há transferência física declarada. Rastreio e conclusão financeira ficam suspensos até conciliação logística.',
    });
    return;
  }
  if (message === 'CUSTODY_TRANSFER_FORBIDDEN') {
    response.status(403).json({ code: message, error: 'A ação exige participação autenticada ou supervisor autorizado.' });
    return;
  }
  if (message === 'CUSTODY_TRANSFER_INVALID') {
    response.status(400).json({ code: message, error: 'Parâmetros de transferência inválidos.' });
    return;
  }
  if (message.startsWith('CUSTODY_TRANSFER_CONFLICT')
    || message === 'CUSTODY_TRANSFER_EXPIRED_OR_CONFLICT') {
    response.status(409).json({ code: 'CUSTODY_TRANSFER_CONFLICT',
      error: 'A transferência está indisponível, mudou ou venceu. Atualize os registros e fale com a logística.' });
    return;
  }
  if (message === 'DELIVERY_RETURN_LIABILITY_FORBIDDEN') {
    response.status(403).json({code:message,error:'A classificação exige operador ativo e revisão independente.'});
    return;
  }
  if (message === 'DELIVERY_RETURN_LIABILITY_INVALID') {
    response.status(400).json({code:message,error:'Causa ou justificativa inválida (20–500 caracteres).'});
    return;
  }
  if (message.startsWith('DELIVERY_RETURN_LIABILITY_')) {
    response.status(409).json({code:message,error:'O protocolo de devolução mudou ou a decisão não pode ser registrada neste estágio.'});
    return;
  }
  if (message === 'DELIVERY_RETURN_ROUTE_FORBIDDEN') {
    response.status(403).json({code:message,error:'A verificação da rota exige operador autorizado, independente de quem autorizou o retorno.'});
    return;
  }
  if (message==='DELIVERY_RETURN_ROUTE_INVALID') {
    response.status(400).json({code:message,error:'Identificador da entrega inválido.'});
    return;
  }
  if (message.startsWith('DELIVERY_RETURN_ROUTE_')) {
    response.status(409).json({code:message,error:'Rota não certificada. Confira endereço original, geofence, política habilitada e disponibilidade do provedor.'});
    return;
  }
  if (message === 'DELIVERY_RETURN_TARIFF_ACCEPTANCE_REQUIRED') {
    response.status(409).json({code:message,error:'Confira e aceite as tarifas e a versão contratual desta oferta.'});
    return;
  }
  if (message === 'DELIVERY_RETURN_ECONOMICS_FORBIDDEN') {
    response.status(403).json({code:message,error:'Somente a equipe administrativa autorizada pode consultar esta conciliação.'});
    return;
  }
  if (message === 'DELIVERY_RETURN_ECONOMICS_INVALID') {
    response.status(400).json({code:message,error:'Identificador de conciliação inválido.'});
    return;
  }
  if (message.startsWith('DELIVERY_RETURN_ECONOMICS_')) {
    response.status(409).json({code:message,error:'A devolução ou sua fonte financeira ainda não está pronta para conciliação.'});
    return;
  }
  if (message === 'DELIVERY_RETURN_FORBIDDEN') {
    response.status(403).json({code:message,
      error:'Somente o operador responsável, o entregador atribuído ou o titular da loja pode confirmar sua própria etapa.'});
    return;
  }
  if (message === 'DELIVERY_RETURN_INVALID') {
    response.status(400).json({code:message,
      error:'A justificativa, condição da encomenda ou identificador é inválido.'});
    return;
  }
  if (message === 'DELIVERY_RETURN_STORE_GEOFENCE_REQUIRED') {
    response.status(409).json({code:message,
      error:'O entregador precisa estar na loja com rastreamento recente e precisão suficiente antes de declarar a devolução.'});
    return;
  }
  if (message === 'DELIVERY_RETURN_CONFLICT') {
    response.status(409).json({code:message,
      error:'O pedido, o responsável ou a etapa da devolução mudou. Não houve liberação financeira ou de custódia.'});
    return;
  }
  if (message === 'RECIPIENT_ABSENCE_FORBIDDEN') {
    response.status(403).json({code:message,
      error:'Somente o entregador responsável pode registrar tentativas de contato nesta entrega.'});
    return;
  }
  if (message === 'RECIPIENT_ABSENCE_INVALID') {
    response.status(400).json({code:message,
      error:'Tentativa de contato inválida. Escolha um meio permitido.'});
    return;
  }
  if (message === 'RECIPIENT_ABSENCE_CONTACT_REQUIRED') {
    response.status(409).json({code:message,
      error:'Registre pelo menos uma tentativa de contato antes de solicitar análise logística.'});
    return;
  }
  if (message === 'RECIPIENT_ABSENCE_LIMIT') {
    response.status(429).json({code:message,
      error:'Limite de registros de contato atingido. Solicite orientação da logística.'});
    return;
  }
  if (message === 'RECIPIENT_ABSENCE_CONFLICT') {
    response.status(409).json({code:message,
      error:'É necessário ter chegado ao destinatário e manter a encomenda atribuída para registrar esta ocorrência.'});
    return;
  }
  if (message === 'DELIVERY_SUPPORT_FORBIDDEN') {
    response.status(403).json({code:message,error:'Somente o entregador responsável ou operador autorizado pode acessar este atendimento.'});
    return;
  }
  if (message === 'DELIVERY_SUPPORT_INVALID') {
    response.status(400).json({code:message,error:'Selecione um motivo válido para a etapa da entrega e revise os dados.'});
    return;
  }
  if (message === 'DELIVERY_SUPPORT_RATE_LIMIT') {
    response.status(429).json({code:message,error:'Aguarde alguns segundos antes de abrir outro chamado. Emergências devem ser comunicadas pelos canais oficiais.'});
    return;
  }
  if (message === 'DELIVERY_SUPPORT_CONFLICT') {
    response.status(409).json({code:message,error:'Este chamado mudou de situação, ou o pedido não está mais nesta etapa.'});
    return;
  }
  if (message === 'INCIDENT_FORBIDDEN') {
    response.status(403).json({
      code: message,
      error: 'A decisão sobre incidentes exige Operations, Compliance ou Super Admin ativo.',
    });
    return;
  }
  if (message === 'INCIDENT_INVALID') {
    response.status(400).json({ code: message, error: 'Informe uma decisão válida e justificativa objetiva.' });
    return;
  }
  if (message.startsWith('INCIDENT_CONFLICT')) {
    response.status(409).json({ code: 'INCIDENT_CONFLICT',
      error: message.includes(':') ? message.split(':').slice(1).join(':')
        : 'A etapa da entrega mudou ou o incidente já foi tratado. Atualize a fila.' });
    return;
  }
  if (message === 'COMPLIANCE_REVIEW_FORBIDDEN') {
    response.status(403).json({ code: message, error: 'A revisão de motofrete exige Compliance ou Super Admin ativo.' });
    return;
  }
  if (message === 'COMPLIANCE_REVIEW_INVALID') {
    response.status(400).json({ code: message, error: 'A decisão de Compliance ou sua validade é inválida.' });
    return;
  }
  if (message === 'COMPLIANCE_REVIEW_CONFLICT') {
    response.status(409).json({ code: message, error: 'A situação da solicitação mudou; atualize a análise.' });
    return;
  }
  if (message === 'COURIER_COMPLIANCE_HOLD') {
    response.status(409).json({
      code: message,
      error: 'Esta entrega de moto exige intervenção logística. Pare em local seguro e contate o suporte.',
    });
    return;
  }
  if (message === 'DELIVERY_PICKUP_FORBIDDEN') {
    response.status(403).json({ error: 'Somente a loja desta entrega pode consultar o código de coleta.' });
    return;
  }
  if (message.startsWith('DELIVERY_CARGO_INVALID:')) {
    response.status(400).json({
      code: 'DELIVERY_CARGO_INVALID',
      error: message.slice('DELIVERY_CARGO_INVALID:'.length).trim(),
    });
    return;
  }
  if (message.startsWith('VEHICLE_NOT_ELIGIBLE:')) {
    response.status(403).json({
      code: 'VEHICLE_NOT_ELIGIBLE',
      error: message.slice('VEHICLE_NOT_ELIGIBLE:'.length).trim(),
    });
    return;
  }
  if (message === 'DELIVERY_CARGO_INCOMPLETE'
    || message === 'DELIVERY_VEHICLE_NOT_COMPATIBLE'
    || message === 'DELIVERY_PAYMENT_MISSING') {
    response.status(409).json({
      code: message,
      error: message === 'DELIVERY_CARGO_INCOMPLETE'
        ? 'A loja ainda precisa classificar peso, dimensões e tipo da carga.'
        : message === 'DELIVERY_VEHICLE_NOT_COMPATIBLE'
          ? 'A carga não é compatível com esse veículo.'
          : 'A remuneração da entrega ainda não está definida.',
    });
    return;
  }
  if (message === 'DELIVERY_BUYER_CONFIRMATION_FORBIDDEN') {
    response.status(403).json({
      error: 'Somente o comprador deste pedido pode confirmar o recebimento.',
      code: 'DELIVERY_BUYER_CONFIRMATION_FORBIDDEN',
    });
    return;
  }
  if (/não identificado|inválido/i.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  if (
    /não encontrado|não está pronto|não é uma entrega|entregador próprio|já aceitou|já foi aceita|somente o entregador|precisa estar aceita|confirme a coleta|código|geofence|rastreio|chegue à loja|coleta segura|rota precisa|chegada ao cliente|ainda não informou|confirmação do cliente|completion|payable|capture|DELIVERY_DESTINATION_RESOLUTION_|DELIVERY_CUSTOMER_ARRIVAL_POLICY_/i.test(
      message
    )
  ) {
    response.status(409).json({ error: message });
    return;
  }
  console.error('[Kyrub Delivery Opportunity]', error);
  response.status(503).json({
    error: message || 'O mural de entregas está temporariamente indisponível.',
  });
};

export const publishKyrubDeliveryOpportunity = async (
  tenantId: string,
  orderId: string
): Promise<Record<string, unknown>> => {
  const orderReference = adminDb.doc(orderPath(tenantId, orderId));

  const storeSnapshot = await adminDb.doc(`users/${tenantId}/stores/${tenantId}`).get();
  const store = storeSnapshot.data() as Record<string, unknown> | undefined;
  const id = deliveryJobId(tenantId, orderId);
  const reference = adminDb.doc(deliveryPath(id));
  const scheduleReference = adminDb.doc(escalationQueuePath(id));
  // Read canonical state inside the transaction. A concurrent courier claim
  // must never be reverted to "available" by a delayed publication callback.
  return adminDb.runTransaction(async transaction => {
    const [orderSnapshot, existing, existingSchedule] = await Promise.all([
      transaction.get(orderReference),
      transaction.get(reference),
      transaction.get(scheduleReference),
    ]);
  const tariffPolicySnap=existing.exists?null
    :await transaction.get(adminDb.doc(RETURN_TARIFF_CONFIG_PATH));
  const order = orderSnapshot.data() as Record<string, unknown> | undefined;
  if (!orderSnapshot.exists || !order) throw new Error('Pedido não encontrado.');
  if (order.fulfillmentType !== 'delivery') throw new Error('Este pedido não é uma entrega.');
  if (clean(order.deliveryProvider) !== 'kyrub') {
    throw new Error('Este pedido está configurado para entregador próprio.');
  }
  const orderStatus = clean(order.status);
  if (!['preparing', 'ready', 'out_for_delivery'].includes(orderStatus)) {
    throw new Error('O pedido ainda não iniciou o preparo para entrega.');
  }
  const now = Timestamp.now();
  const nowIso = now.toDate().toISOString();
  const returnTariffOffer=existing.exists
    ?(validateServerTariffOffer(existing.data()?.returnTariffOfferSnapshot)
      ?existing.data()?.returnTariffOfferSnapshot:null)
    :publishedReturnTariffOffer(tariffPolicySnap?.data(),nowIso);
  const escalationAt = Timestamp.fromMillis(now.toMillis() + ESCALATION_DELAY_MS);
  const deliveryAddress = clean(order.deliveryAddress);
  const destinationResolutionSnapshot = existing.exists
    ? null
    : buildDeliveryDestinationResolutionSnapshotFields(order);
  const [waitingPolicySnapshot, responsibilityPolicySnapshot, customerArrivalPolicySnapshot] = existing.exists
    ? [null, null, null]
    : await Promise.all([
        loadAuthoritativeDeliveryPaidWaitingPolicy(),
        loadAuthoritativeDeliveryResponsibilityPolicy(nowIso),
        loadAuthoritativeDeliveryCustomerArrivalPolicy(nowIso),
      ]);
  const existingCargo = assessDeliveryCargo(existing.data()?.cargo);
  const currentOrderCargo = assessDeliveryCargo(order.deliveryCargo);
  // Retain the last verified seller declaration if another ERP writer sends
  // an older order representation without cargo while an offer is available.
  const cargoAssessment = existing.exists && (
    clean(existing.data()?.status) !== 'available'
      || (!currentOrderCargo.ready && existingCargo.ready)
  ) ? existingCargo : currentOrderCargo;
  const customerGeofenceSnapshot =
    destinationResolutionSnapshot?.customerDestinationResolutionSnapshotStatus === 'resolved' &&
    destinationResolutionSnapshot.customerDestinationResolutionSnapshot &&
    customerArrivalPolicySnapshot
      ? buildDeliveryCustomerDestinationSnapshot({
          latitude: destinationResolutionSnapshot.customerDestinationResolutionSnapshot.latitude,
          longitude: destinationResolutionSnapshot.customerDestinationResolutionSnapshot.longitude,
          radiusMeters: customerArrivalPolicySnapshot.radiusMeters,
          snapshottedAt: nowIso,
        })
      : null;

  const payload = {
    id,
    source: 'kyrub-order',
    sourceOrderId: orderId,
    storeId: tenantId,
    buyerId: clean(order.buyerId),
    orderStatus,
    from: clean(store?.address) || clean(store?.name) || 'Estabelecimento Kyrub',
    to: deliveryAddress,
    distance: finite(order.distance),
    payment: finite(order.deliveryFee),
    ...(!existing.exists?{returnTariffOfferSnapshot:returnTariffOffer}:{}),
    cargo: cargoAssessment.cargo,
    cargoReady: cargoAssessment.ready,
    allowedVehicles: cargoAssessment.allowedVehicles,
    status: existing.exists ? clean(existing.data()?.status) || 'available' : 'available',
    requestedBy: tenantId,
    acceptedBy: clean(existing.data()?.acceptedBy),
    acceptedByName: clean(existing.data()?.acceptedByName),
    orderTotal: finite(order.total),
    customerName: clean(order.buyerName),
    createdAt: existing.exists
      ? existing.data()?.createdAt ?? FieldValue.serverTimestamp()
      : FieldValue.serverTimestamp(),
    availableAt: existing.exists
      ? existing.data()?.availableAt ?? now
      : now,
    escalationAt: existing.exists
      ? existing.data()?.escalationAt ?? escalationAt
      : escalationAt,
    fallbackStatus: clean(existing.data()?.fallbackStatus) || 'waiting_kyrub',
    ...(existing.exists
      ? {}
      : {
          ...destinationResolutionSnapshot,
          customerDestinationResolutionSnapshottedAt: now,
          customerArrivalPolicySnapshot,
          customerArrivalPolicySnapshotStatus: customerArrivalPolicySnapshot
            ? 'captured'
            : 'unavailable_or_disabled',
          customerArrivalPolicySnapshotAuthority: 'kyrub_platform',
          customerArrivalPolicySnapshotSource: DELIVERY_CUSTOMER_ARRIVAL_POLICY_PATH,
          customerArrivalPolicySnapshottedAt: now,
          ...(customerGeofenceSnapshot ? { customerGeofenceSnapshot } : {}),
          customerGeofenceSnapshotStatus: customerGeofenceSnapshot
            ? 'captured'
            : destinationResolutionSnapshot?.customerDestinationResolutionSnapshotStatus === 'review_required'
              ? 'destination_review_required'
              : customerArrivalPolicySnapshot
                ? 'destination_unavailable'
                : 'policy_unavailable_or_disabled',
          customerGeofenceSnapshotAuthority: customerGeofenceSnapshot
            ? 'kyrub_server'
            : 'none',
          waitingPolicySnapshot,
          waitingPolicySnapshotStatus: waitingPolicySnapshot
            ? 'captured'
            : 'unavailable_or_disabled',
          waitingPolicySnapshotAuthority: 'kyrub_platform',
          waitingPolicySnapshotSource: DELIVERY_PAID_WAITING_POLICY_PATH,
          waitingPolicySnapshottedAt: now,
          responsibilityPolicySnapshot,
          responsibilityPolicySnapshotStatus: responsibilityPolicySnapshot
            ? 'captured'
            : 'unavailable_or_disabled',
          responsibilityPolicySnapshotAuthority: 'kyrub_platform',
          responsibilityPolicySnapshotSource: DELIVERY_RESPONSIBILITY_POLICY_PATH,
          responsibilityPolicySnapshottedAt: now,
        }),
    updatedAt: FieldValue.serverTimestamp(),
  };

  transaction.set(reference, payload, { merge: true });
  transaction.set(adminDb.doc(publicOfferPath(id)), {
    ...buildPublicKyrubDeliveryOffer({
      id,
      storeName: clean(store?.name),
      status: String(payload.status),
      orderStatus,
      distance: finite(order.distance),
      payment: finite(order.deliveryFee),
      returnTariffOffer,
      cargo: cargoAssessment.cargo,
      cargoReady: cargoAssessment.ready,
      allowedVehicles: cargoAssessment.allowedVehicles,
    }),
    createdAt: existing.exists ? existing.data()?.createdAt ?? now : now,
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (!existingSchedule.exists) {
    transaction.create(scheduleReference, {
      id,
      deliveryJobId: id,
      sourceOrderId: orderId,
      storeId: tenantId,
      status: 'waiting',
      availableAt: escalationAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
    return { ...payload, created: !existing.exists };
  });
};

/**
 * The store, not a courier or buyer, declares cargo for its own ERP order.
 * This operation never assigns a courier and cannot rewrite an accepted job.
 */
export const classifyKyrubDeliveryOrderCargo = async (
  tenantId: string,
  orderId: string,
  declaredCargo: unknown
): Promise<{ ready: boolean; allowedVehicles: CourierVehicleType[] }> => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(orderId)) {
    throw new Error('Pedido inválido.');
  }
  const assessment = assessDeliveryCargo(declaredCargo);
  if (!assessment.ready || !assessment.cargo) {
    throw new Error('DELIVERY_CARGO_INVALID: ' + assessment.reason);
  }
  const orderReference = adminDb.doc(orderPath(tenantId, orderId));
  const id = deliveryJobId(tenantId, orderId);
  const deliveryReference = adminDb.doc(deliveryPath(id));
  const claimReference = adminDb.doc(claimPath(id));
  const publicReference = adminDb.doc(publicOfferPath(id));

  await adminDb.runTransaction(async transaction => {
    const [orderSnapshot, deliverySnapshot, claimSnapshot] = await Promise.all([
      transaction.get(orderReference),
      transaction.get(deliveryReference),
      transaction.get(claimReference),
    ]);
    const order = orderSnapshot.data() as Record<string, unknown> | undefined;
    if (!order || order.fulfillmentType !== 'delivery' || clean(order.deliveryProvider) !== 'kyrub') {
      throw new Error('Pedido Kyrub Entregas não encontrado.');
    }
    if (!['preparing', 'ready', 'out_for_delivery'].includes(clean(order.status))) {
      throw new Error('Pedido não está em uma etapa de entrega classificável.');
    }
    if (claimSnapshot.exists || (deliverySnapshot.exists
      && clean(deliverySnapshot.data()?.status) !== 'available')) {
      throw new Error('Não é possível alterar a carga de uma entrega já aceita.');
    }
    transaction.update(orderReference, {
      deliveryCargo: assessment.cargo,
      deliveryCargoDeclaredBy: tenantId,
      deliveryCargoDeclaredAt: FieldValue.serverTimestamp(),
    });
    if (deliverySnapshot.exists) {
      transaction.update(deliveryReference, {
        cargo: assessment.cargo,
        cargoReady: true,
        allowedVehicles: assessment.allowedVehicles,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(publicReference, {
        cargo: assessment.cargo,
        cargoReady: true,
        allowedVehicles: assessment.allowedVehicles,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  // Existing publication flow keeps the canonical and public offer in sync.
  await publishKyrubDeliveryOpportunity(tenantId, orderId);
  return { ready: true, allowedVehicles: assessment.allowedVehicles };
};

export const updateKyrubDeliveryStatus = async (
  deliveryId: string,
  status: DeliveryOperationalStatus,
  actor: AuthenticatedActor,
  requestedVehicle?: unknown,
  tariffConsent?:{fingerprint:unknown;confirmed:unknown}
): Promise<void> => {
  const normalizedId = validateDeliveryId(deliveryId);
  const deliveryReference = adminDb.doc(deliveryPath(normalizedId));
  const claimReference = adminDb.doc(claimPath(normalizedId));
  const scheduleReference = adminDb.doc(escalationQueuePath(normalizedId));
  const publicOfferReference = adminDb.doc(publicOfferPath(normalizedId));
  const identityReference = adminDb.doc(`identity_verifications/${actor.uid}`);
  const safetyHoldReference = adminDb.doc(`courierComplianceHolds/${actor.uid}`);

  await adminDb.runTransaction(async transaction => {
    const [deliverySnapshot, claimSnapshot, scheduleSnapshot, identitySnapshot, safetyHoldSnapshot] = await Promise.all([
      transaction.get(deliveryReference),
      transaction.get(claimReference),
      transaction.get(scheduleReference),
      transaction.get(identityReference),
      transaction.get(safetyHoldReference),
    ]);
    if (!deliverySnapshot.exists) {
      throw new Error('Esta entrega não foi encontrada.');
    }

    const delivery = deliverySnapshot.data() as Record<string, unknown>;
    const currentStatus = clean(delivery.status);
    const claim = claimSnapshot.data() as Record<string, unknown> | undefined;
    const courierId = clean(claim?.courierId);

    if (status === 'accepted') {
      if (claimSnapshot.exists) {
        if (courierId === actor.uid) {
          const signed=claim?.returnTariffAcceptedTerms as Record<string,unknown>|undefined;
          if(signed && (tariffConsent?.confirmed!==true
            ||tariffConsent.fingerprint!==signed.offerFingerprint)){
            throw new Error('DELIVERY_RETURN_TARIFF_ACCEPTANCE_REQUIRED');
          }
          return;
        }
        throw new Error('Outro entregador já aceitou esta oportunidade.');
      }
      if (currentStatus !== 'available') {
        throw new Error('Esta entrega já foi aceita.');
      }
      // The vehicle is a requested modality, not authority: check the reviewed
      // identity and seller-declared cargo inside the same acceptance transaction.
      if (!isCourierVehicleType(requestedVehicle)) {
        throw new Error('VEHICLE_NOT_ELIGIBLE: Selecione bicicleta, moto ou carro.');
      }
      const vehicle: CourierVehicleType = requestedVehicle;
      if (vehicle === 'motorcycle' && safetyHoldSnapshot.data()?.active === true) {
        throw new Error('COURIER_COMPLIANCE_HOLD');
      }
      const identity = identitySnapshot.data() as Record<string, unknown> | undefined;
      const vehicleEligibility = courierVehicleDocumentEligibility(identity, vehicle);
      if (!vehicleEligibility.eligible) {
        throw new Error(`VEHICLE_NOT_ELIGIBLE: ${vehicleEligibility.reason}`);
      }
      const assessedCargo = assessDeliveryCargo(delivery.cargo);
      if (!assessedCargo.ready || delivery.cargoReady !== true) {
        throw new Error('DELIVERY_CARGO_INCOMPLETE');
      }
      if (!assessedCargo.allowedVehicles.includes(vehicle)) {
        throw new Error('DELIVERY_VEHICLE_NOT_COMPATIBLE');
      }
      if (finite(delivery.payment) <= 0) {
        throw new Error('DELIVERY_PAYMENT_MISSING');
      }

      const acceptedAt=Timestamp.now();
      const offer=delivery.returnTariffOfferSnapshot;
      const signed=validateServerTariffOffer(offer)
        ?acceptServerReturnTariffOffer({
          offer,deliveryId:normalizedId,courierId:actor.uid,
          acceptedAt:acceptedAt.toDate().toISOString(),
          fingerprint:tariffConsent?.fingerprint,
          confirmed:tariffConsent?.confirmed,
        })
        :null;
      if(!signed&&(tariffConsent?.confirmed===true||tariffConsent?.fingerprint)){
        throw new Error('DELIVERY_RETURN_TARIFF_ACCEPTANCE_REQUIRED');
      }
      transaction.create(claimReference, {
        id: normalizedId,
        deliveryJobId: normalizedId,
        courierId: actor.uid,
        courierName: actor.name,
        vehicleType: vehicle,
        status: 'accepted',
        acceptedAt,
        ...(signed?{returnTariffAcceptedTerms:signed}:{}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(publicOfferReference, { status: 'accepted', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.update(deliveryReference, {
        status: 'accepted',
        acceptedBy: actor.uid,
        acceptedByName: actor.name,
        vehicleType: vehicle,
        acceptedAt,
        fallbackStatus: 'accepted_by_kyrub',
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (scheduleSnapshot.exists) {
        transaction.update(scheduleReference, {
          status: 'cancelled',
          cancelledReason: 'accepted_by_kyrub',
          acceptedBy: actor.uid,
          availableAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    if (!claimSnapshot.exists || courierId !== actor.uid) {
      throw new Error('Somente o entregador responsável pode atualizar a entrega.');
    }

    if (delivery.vehicleType === 'motorcycle') {
      if (safetyHoldSnapshot.data()?.active === true
        || !courierVehicleDocumentEligibility(
          identitySnapshot.data() as Record<string, unknown> | undefined, 'motorcycle'
        ).eligible) {
        throw new Error('COURIER_COMPLIANCE_HOLD');
      }
    }

    if (status === 'delivering') {
      if (currentStatus === 'delivering') return;
      if (clean(delivery.source) === 'kyrub-order') {
        throw new Error('Confirme a coleta segura antes de iniciar a rota.');
      }
      if (currentStatus !== 'accepted') {
        throw new Error('A entrega precisa estar aceita antes da coleta.');
      }
      transaction.update(claimReference, {
        status: 'delivering',
        collectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(publicOfferReference, { status: 'delivering', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.update(deliveryReference, {
        status: 'delivering',
        collectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    if (currentStatus === 'done') return;
    if (clean(delivery.source) === 'kyrub-order') {
      throw new Error('A conclusão da entrega Kyrub depende da confirmação do cliente.');
    }
    if (currentStatus !== 'delivering') {
      throw new Error('Confirme a coleta antes de concluir a entrega.');
    }
    transaction.update(claimReference, {
      status: 'done',
      deliveredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(publicOfferReference, { status: 'done', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.update(deliveryReference, {
      status: 'done',
      deliveredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

export const escalateUnacceptedKyrubDeliveries = async (): Promise<{
  checked: number;
  escalated: number;
  cancelled: number;
}> => {
  const snapshot = await adminDb
    .collection(DELIVERY_ESCALATION_QUEUE)
    .where('availableAt', '<=', Timestamp.now())
    .orderBy('availableAt', 'asc')
    .limit(250)
    .get();
  let checked = 0;
  let escalated = 0;
  let cancelled = 0;

  for (const scheduleDocument of snapshot.docs) {
    checked += 1;
    const didEscalate = await adminDb.runTransaction(async transaction => {
      const scheduleReference = scheduleDocument.ref;
      const deliveryReference = adminDb.doc(deliveryPath(scheduleDocument.id));
      const claimReference = adminDb.doc(claimPath(scheduleDocument.id));
      const [scheduleSnapshot, deliverySnapshot, claimSnapshot] = await Promise.all([
        transaction.get(scheduleReference),
        transaction.get(deliveryReference),
        transaction.get(claimReference),
      ]);
      const schedule = scheduleSnapshot.data() as Record<string, unknown> | undefined;
      if (!scheduleSnapshot.exists || clean(schedule?.status) !== 'waiting') {
        return 'ignored' as const;
      }

      if (claimSnapshot.exists) {
        transaction.update(scheduleReference, {
          status: 'cancelled',
          cancelledReason: 'accepted_by_kyrub',
          availableAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return 'cancelled' as const;
      }

      const delivery = deliverySnapshot.data() as Record<string, unknown> | undefined;
      const escalationReference = adminDb.doc(
        `${ESCALATION_COLLECTION}/${scheduleDocument.id}`
      );
      transaction.set(
        escalationReference,
        {
          id: scheduleDocument.id,
          deliveryJobId: scheduleDocument.id,
          sourceOrderId: clean(schedule?.sourceOrderId) || clean(delivery?.sourceOrderId),
          storeId: clean(schedule?.storeId) || clean(delivery?.storeId),
          status: 'awaiting_provider_routing',
          controlPlane: 'admin.kyrub.com',
          providerCandidates: [],
          reason: 'Nenhum entregador Kyrub aceitou em até 3 minutos.',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      transaction.update(scheduleReference, {
        status: 'escalated',
        availableAt: FieldValue.delete(),
        escalatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (deliverySnapshot.exists) {
        transaction.update(deliveryReference, {
          fallbackStatus: 'queued_for_admin_logistics',
          fallbackQueuedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return 'escalated' as const;
    });

    if (didEscalate === 'escalated') escalated += 1;
    if (didEscalate === 'cancelled') cancelled += 1;
  }

  return { checked, escalated, cancelled };
};

export const createDeliveryOpportunityRouter = (): Router => {
  const router = Router();

  // Reuse the existing serverless delivery router. Client Firestore writes can
  // never approve/revoke motofrete without a server-owned append-only audit.
  router.post('/admin/motofrete-review', async (request, response) => {
    try {
      const reviewerId = await authenticatedTenantId(request);
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown> : {};
      const rawChecks = body.checks && typeof body.checks === 'object'
        && !Array.isArray(body.checks) ? body.checks as Record<string, unknown> : {};
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      const result = await reviewMotofreteWithAudit({
        reviewerId,
        userId: clean(body.userId),
        decision: body.decision === 'approved' || body.decision === 'rejected'
          || body.decision === 'revoked' ? body.decision : 'invalid' as never,
        reason: clean(body.reason),
        validUntilEpochMs: typeof body.validUntilEpochMs === 'number'
          ? body.validUntilEpochMs : null,
        checks: Object.fromEntries(MOTO_CHECKLIST.map(key => [key, rawChecks[key] === true])) as Record<typeof MOTO_CHECKLIST[number], boolean>,
      });
      response.json(result);
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/support-tickets', async (request, response) => {
    try {
      const courierId=await authenticatedTenantId(request);
      response.setHeader('Cache-Control','no-store, max-age=0');
      response.json(await submitCourierSupportTicket({
        deliveryId:request.params.deliveryId,courierId,
        ticketId:clean(request.body?.ticketId),
        reasonCode:clean(request.body?.reasonCode),
        detail:clean(request.body?.detail),
      }));
    } catch(error) { errorResponse(response,error); }
  });

  router.post('/support-tickets/:ticketId/contact-attempt', async (request,response) => {
    try {
      const courierId=await authenticatedTenantId(request);
      const method=request.body?.method;
      if(!['called_recipient','messaged_recipient','tried_intercom','other_contact'].includes(method)) {
        throw new Error('RECIPIENT_ABSENCE_INVALID');
      }
      response.setHeader('Cache-Control','no-store, max-age=0');
      response.json(await declareRecipientContactAttempt({
        ticketId:request.params.ticketId,courierId,
        attemptId:clean(request.body?.attemptId),
        method:method as 'called_recipient'|'messaged_recipient'|'tried_intercom'|'other_contact',
      }));
    } catch(error) { errorResponse(response,error); }
  });

  router.post('/support-tickets/:ticketId/request-absence-review', async (request,response) => {
    try {
      const courierId=await authenticatedTenantId(request);
      response.setHeader('Cache-Control','no-store, max-age=0');
      response.json(await requestRecipientAbsenceReview({
        ticketId:request.params.ticketId,courierId,
      }));
    } catch(error) { errorResponse(response,error); }
  });

  router.post('/admin/support-tickets/:ticketId/authorize-return', async(request,response)=>{
    try {
      const operatorId=await authenticatedTenantId(request);
      response.setHeader('Cache-Control','no-store, max-age=0');
      response.json(await authorizeRecipientAbsenceReturn({
        ticketId:request.params.ticketId,operatorId,reason:clean(request.body?.reason),
      }));
    } catch(error){errorResponse(response,error);}
  });

  router.get('/admin/returns/:deliveryId/economic-preflight', async(request,response)=>{
    try {
      const operatorId=await authenticatedTenantId(request);
      response.setHeader('Cache-Control','private, no-store, max-age=0');
      response.json(await previewDeliveryReturnEconomicReconciliation({
        deliveryId:request.params.deliveryId,operatorId,
      }));
    } catch(error){errorResponse(response,error);}
  });

  router.post('/admin/returns/:deliveryId/route-distance/verify', async(request,response)=>{
    try {
      const operatorId=await authenticatedTenantId(request);
      response.setHeader('Cache-Control','private, no-store, max-age=0');
      response.json(await verifyIndependentReturnDistance({
        deliveryId:request.params.deliveryId,operatorId,
      }));
    }catch(error){errorResponse(response,error);}
  });

  router.get('/admin/returns/:deliveryId/liability-review', async(request,response)=>{
    try {
      const operatorId=await authenticatedTenantId(request);
      response.setHeader('Cache-Control','private, no-store, max-age=0');
      response.json(await getDeliveryReturnLiabilityReview({
        deliveryId:request.params.deliveryId,operatorId,
      }));
    } catch(error){errorResponse(response,error);}
  });

  router.post('/admin/returns/:deliveryId/liability-review/propose', async(request,response)=>{
    try {
      const operatorId=await authenticatedTenantId(request);
      response.setHeader('Cache-Control','private, no-store, max-age=0');
      response.json(await proposeDeliveryReturnLiabilityReview({
        deliveryId:request.params.deliveryId,operatorId,
        cause:request.body?.cause,justification:request.body?.justification,
      }));
    } catch(error){errorResponse(response,error);}
  });

  router.post('/admin/returns/:deliveryId/liability-review/decision', async(request,response)=>{
    try {
      const reviewerId=await authenticatedTenantId(request);
      response.setHeader('Cache-Control','private, no-store, max-age=0');
      response.json(await reviewDeliveryReturnLiability({
        deliveryId:request.params.deliveryId,reviewerId,
        decision:request.body?.decision,reviewReason:request.body?.reviewReason,
      }));
    } catch(error){errorResponse(response,error);}
  });

  router.post('/admin/returns/:deliveryId/revoke', async(request,response)=>{
    try {
      const operatorId=await authenticatedTenantId(request);
      response.setHeader('Cache-Control','no-store, max-age=0');
      response.json(await revokeRecipientAbsenceReturn({
        deliveryId:request.params.deliveryId,operatorId,reason:clean(request.body?.reason),
      }));
    } catch(error){errorResponse(response,error);}
  });

  router.post('/:deliveryId/return-to-store/declare', async(request,response)=>{
    try {
      const courierId=await authenticatedTenantId(request);
      response.setHeader('Cache-Control','no-store, max-age=0');
      response.json(await declareCourierReturnAtStore({
        deliveryId:request.params.deliveryId,courierId,
      }));
    } catch(error){errorResponse(response,error);}
  });

  router.post('/:deliveryId/return-to-store/confirm-receipt', async(request,response)=>{
    try {
      const storeId=await authenticatedTenantId(request);
      const condition=request.body?.condition;
      if(!['intact','damaged','disputed'].includes(condition)){
        throw new Error('DELIVERY_RETURN_INVALID');
      }
      response.setHeader('Cache-Control','no-store, max-age=0');
      response.json(await confirmStoreReceivedReturnedDelivery({
        deliveryId:request.params.deliveryId,storeId,
        condition:condition as 'intact'|'damaged'|'disputed',
        note:clean(request.body?.note),
      }));
    } catch(error){errorResponse(response,error);}
  });

  router.post('/admin/support-tickets/:ticketId/respond', async (request,response) => {
    try {
      const operatorId=await authenticatedTenantId(request);
      const action=request.body?.action;
      if (action!=='take' && action!=='reply' && action!=='resolve') {
        throw new Error('DELIVERY_SUPPORT_INVALID');
      }
      response.setHeader('Cache-Control','no-store, max-age=0');
      response.json(await respondToCourierSupportTicket({
        ticketId:request.params.ticketId,operatorId,action,
        response:clean(request.body?.response),
      }));
    } catch(error) { errorResponse(response,error); }
  });

  router.post('/admin/compliance-incidents/:deliveryId/resolve', async (request, response) => {
    try {
      const operatorId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown> : {};
      const allowed = [
        'release_for_new_acceptance',
        'request_supervised_handoff',
        'close_after_buyer_confirmation',
      ];
      const decision = clean(body.decision);
      if (!allowed.includes(decision)) throw new Error('INCIDENT_INVALID');
      response.json(await resolveDeliveryComplianceIncident({
        deliveryId: request.params.deliveryId,
        operatorId,
        decision: decision as 'release_for_new_acceptance'
          | 'request_supervised_handoff' | 'close_after_buyer_confirmation',
        reason: clean(body.reason),
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/admin/compliance-incidents/:deliveryId/supervised-handoff', async (request, response) => {
    try {
      const operatorId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await proposeSupervisedCustodyTransfer({
        deliveryId: request.params.deliveryId,
        operatorId,
        toCourierId: clean(request.body?.toCourierId),
        targetVehicle: request.body?.targetVehicle,
        reason: clean(request.body?.reason),
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/admin/compliance-incidents/:deliveryId/supervised-handoff/attest', async (request, response) => {
    try {
      const supervisorId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await attestSupervisedCustodyTransfer({
        deliveryId: request.params.deliveryId,
        supervisorId,
        note: clean(request.body?.note),
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/supervised-handoff/acknowledge', async (request, response) => {
    try {
      const actorId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      const statement = request.body?.statement;
      if (statement !== 'physically_handed_over' && statement !== 'physically_received') {
        throw new Error('CUSTODY_TRANSFER_INVALID');
      }
      response.json(await acknowledgeSupervisedCustodyTransfer({
        deliveryId: request.params.deliveryId,
        actorId, statement,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.get('/admin/compliance-incidents/:deliveryId/remuneration/preflight', async (request, response) => {
    try {
      const operatorId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await previewCourierRemunerationReconciliation({
        deliveryId: request.params.deliveryId, operatorId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/admin/compliance-incidents/:deliveryId/remuneration/propose', async (request, response) => {
    try {
      const operatorId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown> : {};
      response.json(await proposeCourierRemunerationReconciliation({
        deliveryId: request.params.deliveryId,
        operatorId,
        outgoingMinor: body.outgoingMinor as number,
        incomingMinor: body.incomingMinor as number,
        reason: clean(body.reason),
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/admin/compliance-incidents/:deliveryId/remuneration/approve', async (request, response) => {
    try {
      const reviewerId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await approveCourierRemunerationReconciliation({
        deliveryId: request.params.deliveryId,
        reviewerId,
        reason: clean(request.body?.reason),
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/remuneration/accept-terms', async (request, response) => {
    try {
      const actorId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await acceptCourierRemunerationTerms({
        deliveryId: request.params.deliveryId, actorId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/admin/compliance-incidents/:deliveryId/execute-reassignment', async (request, response) => {
    try {
      const executorId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control','no-store, max-age=0');
      response.json(await executeSupervisedDeliveryReassignment({
        deliveryId:request.params.deliveryId,
        executorId,reason:clean(request.body?.reason),
      }));
    } catch (error) {
      errorResponse(response,error);
    }
  });

  router.post('/orders/:orderId/publish', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(
        await publishKyrubDeliveryOpportunity(tenantId, request.params.orderId)
      );
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/orders/:orderId/cargo', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await classifyKyrubDeliveryOrderCargo(
        tenantId,
        request.params.orderId,
        request.body?.cargo
      ));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.get('/earnings', async (request, response) => {
    try {
      const courierId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await loadCourierEarningsProjection(courierId));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.get('/:deliveryId/pickup-code', async (request, response) => {
    try {
      const storeId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await readOrCreateDeliveryPickupCodeForStore({
        deliveryId: request.params.deliveryId,
        storeId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/secure-pickup', async (request, response) => {
    try {
      const actor = await authenticatedActor(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      const pickupResult = await confirmSecureCourierPickupAndStartRoute({
        deliveryId: request.params.deliveryId,
        courierId: actor.uid,
        handoffCode: clean(request.body?.handoffCode),
      });
      try {
        await materializeDeliveryResponsibilityAndWaitingDecision({
          deliveryId: request.params.deliveryId,
        });
      } catch (orchestrationError) {
        console.error('[Delivery Responsibility Orchestrator]', orchestrationError);
      }
      response.json(pickupResult);
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/customer-arrival', async (request, response) => {
    try {
      const actor = await authenticatedActor(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await markCourierArrivedAtCustomer({
        deliveryId: request.params.deliveryId,
        courierId: actor.uid,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/buyer-confirmation', async (request, response) => {
    try {
      const buyerId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await confirmBuyerReceivedDelivery({
        deliveryId: request.params.deliveryId,
        buyerId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/status', async (request, response) => {
    try {
      const actor = await authenticatedActor(request);
      const status = parseOperationalStatus(request.body?.status);
      await updateKyrubDeliveryStatus(request.params.deliveryId,status,actor,
        request.body?.vehicleType,{
          confirmed:request.body?.returnTariffAccepted,
          fingerprint:request.body?.returnTariffFingerprint,
        });
      response.status(204).end();
    } catch (error) {
      errorResponse(response, error);
    }
  });

  const escalationHandler = async (request: Request, response: Response) => {
    if (!cronAuthorized(request)) {
      response.status(401).json({ error: 'Cron não autorizado.' });
      return;
    }
    try {
      response.json(await escalateUnacceptedKyrubDeliveries());
    } catch (error) {
      errorResponse(response, error);
    }
  };

  router.get('/internal/escalate', escalationHandler);
  router.post('/internal/escalate', escalationHandler);

  return router;
};
