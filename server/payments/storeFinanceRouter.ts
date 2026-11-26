import {requireStagedFinancialOwnerAccess,requireFinancialPolicyInTransaction} from '../identity/stagedFinancialAuthorization.js';
import { parseStoreFinanceSection } from '../../shared/storeFinanceSections.js';
import { emptyFinanceTaxonomy, normalizeFinanceTaxonomy, mutateFinanceTaxonomy, resolveCustomFinanceRef } from '../../shared/storeFinanceTaxonomy.js';
import { randomUUID } from 'node:crypto';
import { selectStoreCostCenter } from '../../shared/storeFinanceCostCenters.js';
import { Router } from 'express';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';
import {
  buildPaymentCaptureEconomicEntryId,
  buildRecoveredPaymentCaptureEconomicEntry,
  deriveStoreEconomicLedgerSummary,
  storeEconomicLedgerEntryPath,
} from '../../shared/storeEconomicLedger.js';
import {
  ECONOMIC_OBLIGATION_SCHEMA_VERSION,
  type EconomicObligation,
  type EconomicObligationStatus,
} from '../../shared/economicObligations.js';
import {
  buildManualStoreFinancePayable,
  canTransitionStoreFinancePayableStatus,
  normalizeStoreFinancePayable,
  storeFinancePayablePath,
  type StoreFinancePayable,
  type StoreFinancePayableBillingDocumentType,
  type StoreFinancePayableCategory,
  type StoreFinancePayableCostNature,
  type StoreFinancePayableRecurrence,
  type StoreFinancePayableStatus,
} from '../../shared/storeFinancePayables.js';
import { listStoreEconomicLedgerEntries } from './storeEconomicLedgerService.js';
import { listStoreCashFinanceProjection } from './storeCashFinanceProjection.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if(code==='STORE_FINANCE_AGE_REQUIRED')return {status:403,message:'A elegibilidade comercial precisa estar verificada.',code};
  if(code==='second_factor_required'||code==='reauthentication_required')return {status:403,message:'Confirme sua autenticação em dois fatores para acessar o financeiro.',code};
  if(code==='authentication_required'||String((error as {code?:string})?.code??'').startsWith('auth/'))return {status:401,message:'Faça login novamente.',code:'AUTH_REQUIRED'};
  if(code==='FINANCIAL_MFA_PREVIEW_UNAVAILABLE')return {status:503,message:'Homologação financeira indisponível.',code};
  if (code === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente.', code };
  }
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') {
    return { status: 403, message: 'Você não pode consultar o financeiro desta loja.', code };
  }
  if(code==='STORE_FINANCE_SECTION_INVALID')return {status:400,message:'Área financeira inválida.',code};
  if (code === 'STORE_FINANCE_STORE_REQUIRED') {
    return { status: 400, message: 'Loja não identificada.', code };
  }
  if (code === 'STORE_FINANCE_PAYABLE_NOT_FOUND') {
    return { status: 404, message: 'Conta a pagar não encontrada.', code };
  }
  if (code === 'STORE_FINANCE_PAYABLE_TRANSITION_INVALID') {
    return { status: 409, message: 'Esta conta não pode mais receber essa alteração.', code };
  }
  if (code.startsWith('STORE_FINANCE_PAYABLE_')) {
    return { status: 400, message: 'Revise os dados da conta a pagar.', code };
  }
  console.error('[Store finance]', error);
  return {
    status: 503,
    message: 'Não foi possível carregar o financeiro da loja agora.',
    code: 'STORE_FINANCE_UNAVAILABLE',
  };
};

const requireOwner = async (authorization: string, storeId: string): Promise<string> => {
  if(process.env.KYRUB_FINANCIAL_MFA_PREVIEW_ENABLED==='true'){
    const {requireFinancialMfaPreviewOwner}=await import('../identity/financialMfaPreview.js');
    const ownerId=await requireFinancialMfaPreviewOwner(authorization,storeId);
    await requireStagedFinancialOwnerAccess(authorization,ownerId);
    return ownerId;
  }
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  await loadOwnerStoreInstitutionalRepresentation({
    storeId,
    authenticatedUserId: identity.uid,
  });
  await requireStagedFinancialOwnerAccess(authorization,identity.uid);
  return identity.uid;
};

const canRecoverPaidCapture = (payment: CanonicalPayment): boolean =>
  payment.status === 'paid'
  && Boolean(payment.paidAt)
  && Number.isFinite(Date.parse(payment.paidAt))
  && Boolean(payment.provider)
  && Boolean(payment.providerPaymentId);

/**
 * Historical compatibility only. Payments confirmed before the economic ledger
 * was wired can be recovered from their canonical paid snapshot. The entry id is
 * deterministic, so reopening Financeiro cannot duplicate revenue.
 */
/** Recovery is human-initiated historical repair, not a new payment.
 * Read sources and existing captures inside the same transaction; never
 * overwrite a capture created by the provider webhook. */
export const recoverMissingCanonicalPaidCaptures = async (storeId: string,authorization:string,ownerId:string): Promise<number> => {
  return adminDb.runTransaction(async tx=>{
    if(storeId!==ownerId||!/^[A-Za-z0-9_-]{1,128}$/.test(storeId))throw Error('STORE_REPRESENTATION_FORBIDDEN');
    const owner=await tx.get(adminDb.doc('users/'+storeId+'/stores/'+storeId));
    if(!owner.exists||owner.get('id')!==storeId||owner.get('ownerId')!==ownerId)throw Error('STORE_REPRESENTATION_FORBIDDEN');
    await requireFinancialPolicyInTransaction(tx,authorization,ownerId);
    const snapshot=await tx.get(adminDb.collection(`stores/${storeId}/payments`).where('status','==','paid').limit(100));
    const candidates=snapshot.docs.flatMap(document=>{
      try{
        const raw=document.data() as CanonicalPayment;
        if(raw.id!==document.id||raw.storeId!==storeId||raw.currency!=='BRL')return [];
        const payment=normalizeCanonicalPayment(raw);
        return canRecoverPaidCapture(payment)?[payment]:[];
      }catch{return [];}
    });
    if(!candidates.length)return 0;
    const refs=candidates.map(payment=>adminDb.doc(storeEconomicLedgerEntryPath(storeId,buildPaymentCaptureEconomicEntryId(payment.id))));
    const existing=await tx.getAll(...refs);
    let recoveredCount=0;
    for(const [index,payment] of candidates.entries()){
      if(existing[index].exists)continue;
      const entry=buildRecoveredPaymentCaptureEconomicEntry({payment,paymentIntentId:payment.paymentIntentId??''});
      tx.create(refs[index],entry);
      recoveredCount++;
    }
    return recoveredCount;
  });
};

type StoreReceivableView = Pick<
  EconomicObligation,
  | 'id'
  | 'status'
  | 'amountMinor'
  | 'paymentId'
  | 'orderId'
  | 'createdAt'
  | 'eligibleAt'
  | 'settledAt'
  | 'reversedAt'
>;

type StoreReceivableSummary = {
  currency: 'BRL';
  pendingMinor: number;
  eligibleMinor: number;
  settledMinor: number;
  reversedMinor: number;
  openMinor: number;
  count: number;
};

type StorePayableSummary = {
  currency: 'BRL';
  openMinor: number;
  overdueMinor: number;
  dueSoonMinor: number;
  paidMinor: number;
  count: number;
  openCount: number;
};

const isEconomicObligationStatus = (value: unknown): value is EconomicObligationStatus =>
  value === 'pending' || value === 'eligible' || value === 'settled' || value === 'reversed';

const parseStoreReceivable = (
  storeId: string,
  documentId: string,
  value: unknown
): StoreReceivableView | null => {
  if (!value || typeof value !== 'object') return null;
  const obligation = value as Partial<EconomicObligation>;
  if (
    obligation.schemaVersion !== ECONOMIC_OBLIGATION_SCHEMA_VERSION ||
    obligation.id !== documentId ||
    obligation.storeId !== storeId ||
    obligation.kind !== 'store_receivable' ||
    !isEconomicObligationStatus(obligation.status) ||
    obligation.currency !== 'BRL' ||
    !Number.isSafeInteger(obligation.amountMinor) ||
    Number(obligation.amountMinor) <= 0 ||
    obligation.beneficiaryType !== 'store' ||
    obligation.beneficiaryPrincipalId !== `store:${storeId}` ||
    obligation.sourceAuthority !== 'economic_allocation_snapshot' ||
    !clean(obligation.paymentId) ||
    !clean(obligation.orderId) ||
    !clean(obligation.createdAt) ||
    !Number.isFinite(Date.parse(clean(obligation.createdAt)))
  ) {
    return null;
  }

  return {
    id: obligation.id,
    status: obligation.status,
    amountMinor: obligation.amountMinor,
    paymentId: clean(obligation.paymentId),
    orderId: clean(obligation.orderId),
    createdAt: clean(obligation.createdAt),
    eligibleAt: clean(obligation.eligibleAt),
    settledAt: clean(obligation.settledAt),
    reversedAt: clean(obligation.reversedAt),
  };
};

const listStoreReceivables = async (storeId: string): Promise<{
  summary: StoreReceivableSummary;
  items: StoreReceivableView[];
}> => {
  const snapshot = await adminDb
    .collection(`stores/${storeId}/economicObligations`)
    .where('kind', '==', 'store_receivable')
    .limit(100)
    .get();

  const items = snapshot.docs.flatMap(document => {
    const receivable = parseStoreReceivable(storeId, document.id, document.data());
    if (receivable) return [receivable];
    console.warn('[Store finance] Invalid store receivable skipped.', {
      storeId,
      obligationId: document.id,
    });
    return [];
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  const amountFor = (status: EconomicObligationStatus): number =>
    items
      .filter(item => item.status === status)
      .reduce((total, item) => total + item.amountMinor, 0);

  const pendingMinor = amountFor('pending');
  const eligibleMinor = amountFor('eligible');
  const settledMinor = amountFor('settled');
  const reversedMinor = amountFor('reversed');

  return {
    summary: {
      currency: 'BRL',
      pendingMinor,
      eligibleMinor,
      settledMinor,
      reversedMinor,
      openMinor: pendingMinor + eligibleMinor,
      count: items.length,
    },
    items,
  };
};

const listStorePayables = async (storeId: string): Promise<{
  summary: StorePayableSummary;
  items: StoreFinancePayable[];
}> => {
  const snapshot = await adminDb
    .collection(`stores/${storeId}/financePayables`)
    .limit(100)
    .get();

  const items = snapshot.docs.flatMap(document => {
    try {
      return [normalizeStoreFinancePayable({
        ...(document.data() as StoreFinancePayable),
        id: document.id,
        storeId,
      })];
    } catch (error) {
      console.warn('[Store finance] Invalid payable skipped.', {
        storeId,
        payableId: document.id,
        error: error instanceof Error ? error.message : 'unknown',
      });
      return [];
    }
  }).sort((left, right) => {
    const statusOrder = (status: StoreFinancePayableStatus): number =>
      status === 'open' ? 0 : status === 'paid' ? 1 : 2;
    const byStatus = statusOrder(left.status) - statusOrder(right.status);
    if (byStatus !== 0) return byStatus;
    const byDueDate = left.dueDate.localeCompare(right.dueDate);
    if (byDueDate !== 0) return byDueDate;
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });

  const today = new Date().toISOString().slice(0, 10);
  const dueSoonDate = new Date(`${today}T12:00:00.000Z`);
  dueSoonDate.setUTCDate(dueSoonDate.getUTCDate() + 7);
  const dueSoonLimit = dueSoonDate.toISOString().slice(0, 10);
  const openItems = items.filter(item => item.status === 'open');
  const paidItems = items.filter(item => item.status === 'paid');
  const sum = (values: StoreFinancePayable[]): number =>
    values.reduce((total, item) => total + item.amountMinor, 0);

  return {
    summary: {
      currency: 'BRL',
      openMinor: sum(openItems),
      overdueMinor: sum(openItems.filter(item => item.dueDate < today)),
      dueSoonMinor: sum(openItems.filter(item => item.dueDate >= today && item.dueDate <= dueSoonLimit)),
      paidMinor: sum(paidItems),
      count: items.length,
      openCount: openItems.length,
    },
    items,
  };
};

const payableCategory = (value: unknown): StoreFinancePayableCategory => {
  const category = clean(value);
  if (
    category === 'supplier'
    || category === 'inventory'
    || category === 'rent'
    || category === 'utilities'
    || category === 'tax'
    || category === 'service'
    || category === 'other'
  ) {
    return category;
  }
  throw new Error('STORE_FINANCE_PAYABLE_CATEGORY_INVALID');
};

const payableRecurrence = (value: unknown): StoreFinancePayableRecurrence => {
  const recurrence = clean(value);
  if (recurrence === 'none' || recurrence === 'monthly') return recurrence;
  throw new Error('STORE_FINANCE_PAYABLE_RECURRENCE_INVALID');
};

const payableCostNature = (value: unknown): StoreFinancePayableCostNature => {
  const nature = clean(value);
  if (!nature || nature === 'unspecified') return 'unspecified';
  if (nature === 'fixed' || nature === 'variable') return nature;
  throw new Error('STORE_FINANCE_PAYABLE_COST_NATURE_INVALID');
};

const payableBillingDocumentType = (
  value: unknown
): StoreFinancePayableBillingDocumentType => {
  const type = clean(value);
  if (!type || type === 'none') return 'none';
  if (type === 'boleto' || type === 'invoice' || type === 'other') return type;
  throw new Error('STORE_FINANCE_PAYABLE_BILLING_DOCUMENT_TYPE_INVALID');
};

const financeTaxonomyRef=(storeId:string)=>adminDb.doc('stores/'+storeId+'/financeConfig/taxonomy');
const decodeFinanceTaxonomy=(data:FirebaseFirestore.DocumentData|undefined)=>data===undefined?emptyFinanceTaxonomy():data.schemaVersion===1?normalizeFinanceTaxonomy(data.taxonomy):(()=>{throw Error('STORE_FINANCE_PAYABLE_TAXONOMY_INVALID');})();

const transitionPayable = async (input: {
  storeId: string;
  payableId: string;
  to: Exclude<StoreFinancePayableStatus, 'open'>;
  authorization:string;
  ownerId:string;
}): Promise<StoreFinancePayable> => {
  const ref = adminDb.doc(storeFinancePayablePath(input.storeId, input.payableId));
  return adminDb.runTransaction(async transaction => {
    await requireFinancialPolicyInTransaction(transaction,input.authorization,input.ownerId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('STORE_FINANCE_PAYABLE_NOT_FOUND');
    const current = normalizeStoreFinancePayable({
      ...(snapshot.data() as StoreFinancePayable),
      id: input.payableId,
      storeId: input.storeId,
    });
    if (!canTransitionStoreFinancePayableStatus(current.status, input.to)) {
      throw new Error('STORE_FINANCE_PAYABLE_TRANSITION_INVALID');
    }
    if (current.status === input.to) return current;

    const now = new Date().toISOString();
    const next = normalizeStoreFinancePayable({
      ...current,
      status: input.to,
      updatedAt: now,
      paidAt: input.to === 'paid' ? now : '',
      cancelledAt: input.to === 'cancelled' ? now : '',
    });
    transaction.set(ref, next);
    return next;
  });
};

export const createStoreFinanceRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_FINANCE_STORE_REQUIRED');
      const ownerId = await requireOwner(request.get('authorization') ?? '', storeId);

      const section=parseStoreFinanceSection(request.query.section);
      // The old unscoped contract remains available. Scoped sections do not
      // recover or read unrelated financial collections.
      if(section==='payables'){
        const [payables,taxonomySnapshot]=await Promise.all([listStorePayables(storeId),financeTaxonomyRef(storeId).get()]);
        response.status(200).json({storeId,section,payableSummary:payables.summary,payables:payables.items,taxonomy:decodeFinanceTaxonomy(taxonomySnapshot.data())});
        return;
      }
      if(section==='receivables'){
        const receivables=await listStoreReceivables(storeId);
        response.status(200).json({storeId,section,receivableSummary:receivables.summary,receivables:receivables.items});
        return;
      }
      if(section==='cash'){
        const cash=await listStoreCashFinanceProjection({financeStoreId:storeId,ownerId});
        response.status(200).json({storeId,section,cash});
        return;
      }
      const recoveredCount = await recoverMissingCanonicalPaidCaptures(storeId,request.get('authorization')??'',ownerId);
      if(section==='overview'||section==='movements'){
        const entries=await listStoreEconomicLedgerEntries({storeId,limit:100});
        response.status(200).json({storeId,section,summary:deriveStoreEconomicLedgerSummary(entries),entries,recoveredCount});
        return;
      }
      const [entries, receivables, payables, cash, taxonomySnapshot] = await Promise.all([
        listStoreEconomicLedgerEntries({ storeId, limit: 100 }),
        listStoreReceivables(storeId),
        listStorePayables(storeId),
        listStoreCashFinanceProjection({ financeStoreId: storeId, ownerId }),
        financeTaxonomyRef(storeId).get(),
      ]);
      const summary = deriveStoreEconomicLedgerSummary(entries);

      response.status(200).json({
        storeId,
        summary,
        entries,
        recoveredCount,
        receivableSummary: receivables.summary,
        receivables: receivables.items,
        payableSummary: payables.summary,
        payables: payables.items,
        taxonomy: decodeFinanceTaxonomy(taxonomySnapshot.data()),
        cash,
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/', async (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? request.body as Record<string, unknown>
        : {};
      const storeId = clean(body.storeId);
      if (!storeId) throw new Error('STORE_FINANCE_STORE_REQUIRED');
      const ownerId = await requireOwner(request.get('authorization') ?? '', storeId);
      const action = clean(body.action);

      if(action==='mutate_taxonomy'){
        const kind=body.kind, operation=body.operation;
        if(kind!=='centers'&&kind!=='categories')throw Error('STORE_FINANCE_PAYABLE_TAXONOMY_INVALID');
        const id=operation==='create'?(kind==='centers'?'cc_custom_':'cat_custom_')+randomUUID():body.id;
        const ref=financeTaxonomyRef(storeId);
        const taxonomy=await adminDb.runTransaction(async tx=>{
          await requireFinancialPolicyInTransaction(tx,request.get('authorization')??'',ownerId);
          const current=decodeFinanceTaxonomy((await tx.get(ref)).data());
          const next=mutateFinanceTaxonomy(current,kind,operation,id,body.name);
          tx.set(ref,{schemaVersion:1,taxonomy:next});
          return next;
        });
        response.status(200).json({taxonomy,id});
        return;
      }

      if (action === 'create_payable') {
        const billingDocumentType = payableBillingDocumentType(body.billingDocumentType);
        const id = 'payable_'+randomUUID();
        const payable = await adminDb.runTransaction(async tx => {
          await requireFinancialPolicyInTransaction(tx,request.get('authorization')??'',ownerId);
          const customCenter=typeof body.costCenterId==='string'&&body.costCenterId.startsWith('cc_custom_');
          const customCategoryRequested=body.customCategoryId!==undefined&&body.customCategoryId!=='';
          const taxonomy=customCenter||customCategoryRequested?decodeFinanceTaxonomy((await tx.get(financeTaxonomyRef(storeId))).data()):emptyFinanceTaxonomy();
          const center=customCenter?resolveCustomFinanceRef(taxonomy,'centers',body.costCenterId):selectStoreCostCenter(body.costCenterId);
          const customCategory=customCategoryRequested?resolveCustomFinanceRef(taxonomy,'categories',body.customCategoryId):undefined;
          if(customCategory&&body.category!=='other')throw Error('STORE_FINANCE_PAYABLE_TAXONOMY_INVALID');
          const next = buildManualStoreFinancePayable({
          id,
          costCenter: center,
          customCategory,
          storeId,
          amountMinor: Number(body.amountMinor),
          description: clean(body.description),
          category: payableCategory(body.category),
          counterparty: clean(body.counterparty),
          dueDate: clean(body.dueDate),
          recurrence: payableRecurrence(body.recurrence),
          costNature: payableCostNature(body.costNature),
          billingDocumentType,
          billingDocumentReference: billingDocumentType === 'none'
            ? ''
            : clean(body.billingDocumentReference),
          billingDigitableLine: billingDocumentType === 'boleto'
            ? clean(body.billingDigitableLine)
            : '',
          billingBarcode: billingDocumentType === 'boleto'
            ? clean(body.billingBarcode)
            : '',
          createdByUserId: ownerId,
        });
          tx.create(adminDb.doc(storeFinancePayablePath(storeId, next.id)),next);
          return next;
        });
        response.status(201).json({ payable });
        return;
      }

      const payableId = clean(body.payableId);
      if (!payableId) throw new Error('STORE_FINANCE_PAYABLE_ID_INVALID');
      if (action === 'mark_payable_paid') {
        const payable = await transitionPayable({ storeId, payableId, to: 'paid',authorization:request.get('authorization')??'',ownerId });
        response.status(200).json({ payable });
        return;
      }
      if (action === 'cancel_payable') {
        const payable = await transitionPayable({ storeId, payableId, to: 'cancelled',authorization:request.get('authorization')??'',ownerId });
        response.status(200).json({ payable });
        return;
      }

      throw new Error('STORE_FINANCE_PAYABLE_ACTION_INVALID');
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};