import {
  resolveKyrubiaMercadoLivreGenericConfirmationGuard,
} from '../server/ai/kyrubiaMercadoLivreGenericConfirmationGuard.js';
import {
  handleKyrubMcpRequest,
  type KyrubMcpHttpRequest,
  type KyrubMcpHttpResponse,
} from '../server/mcp/kyrubiaMcpServer.js';

type RequestLike = KyrubMcpHttpRequest & {
  query?: Record<string, string | string[] | undefined>;
};

type ResponseLike = KyrubMcpHttpResponse;

export type KyrubHealthPayload = {
  status: 'ok';
  service: 'kyrub';
  environment: string;
  release: string;
  timestamp: string;
  capabilities: {
    kyrubia: 'configured' | 'unconfigured';
  };
};

const releaseIdentifier = (): string =>
  process.env.KYRUB_RELEASE?.trim()
  || process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 12)
  || process.env.npm_package_version?.trim()
  || 'development';

export const buildKyrubHealthPayload = (
  now: Date = new Date()
): KyrubHealthPayload => ({
  status: 'ok',
  service: 'kyrub',
  environment: process.env.VERCEL_ENV?.trim()
    || process.env.NODE_ENV?.trim()
    || 'development',
  release: releaseIdentifier(),
  timestamp: now.toISOString(),
  capabilities: {
    kyrubia: process.env.GEMINI_API_KEY?.trim()
      ? 'configured'
      : 'unconfigured',
  },
});

const queryValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const headerValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const safeLogIdentifier = (value: unknown): string => {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9:_-]{1,160}$/.test(cleaned) ? cleaned : '';
};

const createTraceId = (): string =>
  `kyrub-route-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const requestTraceId = (request: RequestLike): string =>
  safeLogIdentifier(
    headerValue(
      request.headers['x-kyrub-request-id']
      ?? request.headers['X-Kyrub-Request-Id']
    )
  ) || createTraceId();

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  const traceId = requestTraceId(request);
  const transport = queryValue(request.query?.transport);
  response.setHeader('X-Kyrub-Release', releaseIdentifier());
  response.setHeader('X-Kyrub-Request-Id', traceId);
  response.setHeader('X-Kyrub-Route', 'health-multiplexer');
  response.setHeader('X-Kyrub-Decision', transport || 'health');

  if (transport === 'official-operational-phase') {
    response.setHeader('Cache-Control','no-store, max-age=0');
    if((request.method??'GET').toUpperCase()!=='GET'){response.status(405).json({error:'METHOD_NOT_ALLOWED'});return;}
    try{
      const {readOfficialPhaseBearerToken}=await import('../shared/officialOperationalPhase.js');
      const bearer=readOfficialPhaseBearerToken(headerValue(request.headers.authorization??request.headers.Authorization));
      if(!bearer||bearer.length>8192)throw Error('AUTH_REQUIRED');
      const {verifyFirebaseIdToken}=await import('../server/ai/consultantAuth.js');
      const identity=await verifyFirebaseIdToken(bearer);
      const storeId=queryValue(request.query?.storeId);
      const {getOfficialOperationalPhaseForOwner}=await import('../server/admin/officialOperationalPhaseService.js');
      response.status(200).json(await getOfficialOperationalPhaseForOwner({legacyStoreId:storeId,actorId:identity.uid}));
    }catch(error){
      const code=error instanceof Error?error.message:'';
      response.status(code==='AUTH_REQUIRED'?401:403).json({error:'Marco operacional indisponível para esta loja.',code:code==='AUTH_REQUIRED'?'AUTH_REQUIRED':'OFFICIAL_PHASE_FORBIDDEN'});
    }
    return;
  }

  if (transport === 'public-kyrub-tag' || transport === 'manage-kyrub-tag') {
    response.setHeader('Cache-Control','no-store, max-age=0');
    const method=(request.method??'GET').toUpperCase(),managing=transport==='manage-kyrub-tag';
    if((!managing&&method!=='GET')||(managing&&!['GET','POST','DELETE'].includes(method))){
      response.setHeader('Allow',managing?'GET, POST, DELETE':'GET');response.status(405).json({error:'METHOD_NOT_ALLOWED'});return;
    }
    let actor='';
    if(managing){
      try{
        const bearer=/^Bearer ([^\s]+)$/i.exec(headerValue(request.headers.authorization??request.headers.Authorization))?.[1];
        if(!bearer||bearer.length>8192)throw Error('AUTH_REQUIRED');
        const {adminAuth}=await import('../server/firebaseAdmin.js');
        actor=(await adminAuth.verifyIdToken(bearer,true)).uid;
        if(!/^[A-Za-z0-9_-]{1,128}$/.test(actor))throw Error('AUTH_REQUIRED');
      }catch{response.status(401).json({error:'AUTH_REQUIRED'});return;}
    }
    const id=queryValue(request.query?.id);
    try{
      const service=await import('../server/identity/kyrubTagService.js');
      if(!managing){const result=await service.resolveKyrubTag(id);response.status(result?200:404).json(result??{error:'TAG_NOT_FOUND'});return;}
      if(method==='GET'){response.status(200).json(queryValue(request.query?.view)==='destinations'?await service.loadTagDestinationCatalog(actor,id):id?await service.loadOwnedKyrubTag(actor,id):await service.listOwnedKyrubTags(actor));return;}
      if(method==='DELETE'){response.status(200).json(await service.disableKyrubTag(actor,id));return;}
      const body=request.body;
      if(!body||typeof body!=='object'||Array.isArray(body)){response.status(400).json({error:'TAG_INVALID'});return;}
      const data=body as Record<string,unknown>;
      if(data.action==='claim-reserved'&&Object.keys(data).length===1){
        const {adminAuth}=await import('../server/firebaseAdmin.js');
        const identity=await adminAuth.getUser(actor);
        if(identity.disabled||identity.emailVerified!==true||!identity.email)throw Error('TAG_FORBIDDEN');
        response.status(200).json(await service.claimReservedKyrubTag(actor,id,identity.email));return;
      }
      if(data.action==='claim'&&Object.keys(data).length===2){response.status(200).json(await service.claimKyrubTag(actor,id,data.code));return;}
      if(data.action==='configure'&&Object.keys(data).length===2){response.status(200).json(await service.configureKyrubTag(actor,id,data.urls));return;}
      response.status(400).json({error:'TAG_INVALID'});
    }catch(error){
      const code=error instanceof Error?error.message:'';
      if(code==='TAG_INVALID'||code==='INVALID_CARD')response.status(400).json({error:'TAG_INVALID'});
      else if(code==='TAG_FORBIDDEN')response.status(403).json({error:'TAG_FORBIDDEN'});
      else if(code==='CARD_TARGET_UNAVAILABLE'||code==='TAG_CHANGED')response.status(409).json({error:code});
      else response.status(503).json({error:'TAG_UNAVAILABLE'});
    }
    return;
  }

  if (transport === 'public-visit-card' || transport === 'manage-public-visit-card') {
    response.setHeader('Cache-Control','no-store, max-age=0');
    const method=(request.method??'GET').toUpperCase();
    const managing=transport==='manage-public-visit-card';
    if ((!managing && method!=='GET') || (managing && !['GET','POST','DELETE'].includes(method))) {
      response.setHeader('Allow',managing?'GET, POST, DELETE':'GET');
      response.status(405).json({error:'METHOD_NOT_ALLOWED'});return;
    }
    let actor='';
    if(managing){
      try{
        const {authenticateConsultantRequest}=await import('../server/ai/consultantAuth.js');
        actor=(await authenticateConsultantRequest(headerValue(request.headers.authorization??request.headers.Authorization))).uid;
        if(!/^[A-Za-z0-9_-]{1,128}$/.test(actor))throw Error('AUTH_REQUIRED');
      }catch{response.status(401).json({error:'AUTH_REQUIRED'});return;}
    }
    try{
      const service=await import('../server/identity/publicVisitCardService.js');
      if(!managing){
        const result=await service.resolvePublicCard(queryValue(request.query?.id));
        response.status(result?200:404).json(result??{error:'CARD_NOT_FOUND'});return;
      }
      if(method==='GET'){response.status(200).json({card:await service.loadOwnedCard(actor)});return;}
      if(method==='DELETE'){response.status(200).json({card:await service.disableOwnedCard(actor)});return;}
      const body=request.body;
      const urls=body&&typeof body==='object'&&!Array.isArray(body)?(body as Record<string,unknown>).urls:null;
      response.status(200).json({card:await service.saveOwnedCard(actor,urls)});
    }catch(error){
      const code=error instanceof Error?error.message:'';
      if(code==='INVALID_CARD')response.status(400).json({error:code});
      else if(code==='CARD_TARGET_UNAVAILABLE')response.status(409).json({error:code});
      else response.status(503).json({error:'CARD_UNAVAILABLE'});
    }
    return;
  }

  if (transport === 'manage-public-social-address') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    const method = (request.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let actor: string;
    try {
      const { authenticateConsultantRequest } = await import('../server/ai/consultantAuth.js');
      actor = (await authenticateConsultantRequest(headerValue(request.headers.authorization ?? request.headers.Authorization))).uid;
    } catch (error) {
      const status = (error as {status?: number; statusCode?: number} | null)?.status ??
        (error as {statusCode?: number} | null)?.statusCode;
      response.status(status === 503 ? 503 : 401).json({error:'AUTH_REQUIRED'});
      return;
    }
    const kind = queryValue(request.query?.kind);
    if (kind !== 'profile' && kind !== 'community') {
      response.status(400).json({error:'INVALID_PUBLIC_ADDRESS'});
      return;
    }
    const communityId = queryValue(request.query?.communityId);
    try {
      const { getOwnedSocialAddress, reserveSocialAddress } = await import('../server/identity/publicSocialAddressService.js');
      if (method === 'GET') {
        response.status(200).json(await getOwnedSocialAddress(actor,kind,communityId));
        return;
      }
      const body = request.body;
      const identifier = body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string,unknown>).identifier : null;
      if (typeof identifier !== 'string' || identifier.length > 120) {
        response.status(400).json({error:'INVALID_PUBLIC_ADDRESS'});
        return;
      }
      const result = await reserveSocialAddress(actor,kind,identifier,communityId);
      response.status(200).json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'INVALID_PUBLIC_ADDRESS') response.status(400).json({error:code});
      else if (code === 'PUBLIC_ADDRESS_FORBIDDEN') response.status(403).json({error:code});
      else if (code === 'PUBLIC_ADDRESS_CONFLICT') response.status(409).json({error:code});
      else response.status(503).json({error:'PUBLIC_ADDRESS_UNAVAILABLE'});
    }
    return;
  }

  if (transport === 'public-social-address') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    const method = (request.method ?? 'GET').toUpperCase();
    if (method !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      const { isSocialAddress } = await import('../server/identity/publicSocialAddressPolicy.js');
      const kind = queryValue(request.query?.kind);
      const identifier = queryValue(request.query?.identifier);
      if (!isSocialAddress(kind,identifier)) {
        response.status(404).json({ error: 'PUBLIC_ADDRESS_NOT_FOUND' });
        return;
      }
      const { resolveSocialAddress } = await import('../server/identity/publicSocialAddressService.js');
      const result = await resolveSocialAddress(kind,identifier);
      if (!result) response.status(404).json({ error: 'PUBLIC_ADDRESS_NOT_FOUND' });
      else response.status(200).json(result);
    } catch {
      response.status(503).json({ error: 'PUBLIC_ADDRESS_UNAVAILABLE' });
    }
    return;
  }

  if (transport === 'public-community-page') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      const { listPublicCommunityPage, parsePublicCommunityCursor } = await import(
        '../server/marketplace/publicCommunityPageService.js'
      );
      const cursor = parsePublicCommunityCursor(queryValue(request.query?.cursor));
      response.status(200).json(await listPublicCommunityPage(cursor ?? undefined));
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_COMMUNITY_CURSOR') {
        response.status(400).json({ error: 'INVALID_COMMUNITY_CURSOR' });
        return;
      }
      console.warn('[public-community-page]', error instanceof Error ? error.message : 'unavailable');
      response.status(503).json({ error: 'PUBLIC_COMMUNITY_PAGE_UNAVAILABLE' });
    }
    return;
  }

  if (transport === 'public-square-discovery') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      const { listPublicSquareDiscovery } = await import(
        '../server/marketplace/publicSquareDiscoveryService.js'
      );
      response.status(200).json(await listPublicSquareDiscovery());
    } catch (error) {
      console.warn('[public-square-discovery]', error instanceof Error ? error.message : 'unavailable');
      response.status(503).json({ error: 'PUBLIC_SQUARE_DISCOVERY_UNAVAILABLE' });
    }
    return;
  }

  if (transport === 'public-delivery-discovery') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      const { listPublicDeliveryOpportunities } = await import(
        '../server/delivery/publicDeliveryDiscoveryService.js'
      );
      response.status(200).json(await listPublicDeliveryOpportunities());
    } catch (error) {
      console.warn('[public-delivery-discovery]', error instanceof Error ? error.message : 'unavailable');
      response.status(503).json({ error: 'PUBLIC_DELIVERY_DISCOVERY_UNAVAILABLE' });
    }
    return;
  }

  if (transport === 'store-relationship') {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.status(405).json({ error: 'Método não permitido.' });
      return;
    }
    try {
      const authorization = headerValue(request.headers.authorization ?? request.headers.Authorization);
      const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
      if (!token) {
        response.status(401).json({ error: 'Faça login novamente para consultar seu relacionamento.' });
        return;
      }
      const storeId = queryValue(request.query?.storeId).trim();
      if (!storeId) {
        response.status(400).json({ error: 'Loja não identificada.' });
        return;
      }
      const [{ verifyFirebaseIdToken }, { loadStoreRelationshipForViewer }] = await Promise.all([
        import('../server/ai/consultantAuth.js'),
        import('../server/payments/storeRelationshipService.js'),
      ]);
      const identity = await verifyFirebaseIdToken(token);
      const summary = await loadStoreRelationshipForViewer({ storeId, customerId: identity.uid });
      response.status(200).json(summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('STORE_RELATIONSHIP_')) {
        console.warn('[store-relationship]', message);
        response.status(409).json({ error: 'Os dados de fidelidade desta loja estão inconsistentes.' });
      } else if (/AUTH_|TOKEN_|UNAUTHORIZED|INVALID_ID_TOKEN/i.test(message)) {
        response.status(401).json({ error: 'Faça login novamente para consultar seu relacionamento.' });
      } else {
        console.error('[store-relationship]', error);
        response.status(503).json({ error: 'Não foi possível carregar seu relacionamento com a loja.' });
      }
    }
    return;
  }

  if (transport === 'pitanga-account') {
    const { handlePitangaAccountRequest } = await import('../server/gamification/pitangaAccountHandler.js');
    await handlePitangaAccountRequest(request, response);
    return;
  }

  if (transport === 'kairubi-xp-total') {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    const authorization = headerValue(request.headers.authorization ?? request.headers.Authorization);
    const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
    if (!token) {
      response.status(401).json({ error: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const [{ verifyFirebaseIdToken }, { adminDb }, { kyrubXpTotal }] = await Promise.all([
        import('../server/ai/consultantAuth.js'),
        import('../server/firebaseAdmin.js'),
        import('../shared/gamification.js'),
      ]);
      const actor = await verifyFirebaseIdToken(token);
      const snapshot = await adminDb.collection(`users/${actor.uid}/xpLedger`).get();
      const entries = snapshot.docs.map(document => {
        const entry = document.data() as import('../shared/gamification.js').KyrubXpEntry;
        if (entry.userId !== actor.uid || entry.id !== document.id) throw new Error('XP_LEDGER_SCOPE_INVALID');
        return entry;
      });
      response.status(200).json({
        schemaVersion: 1,
        unit: 'kyrub_xp',
        status: entries.length === 0 ? 'no_entries' : 'available',
        total: entries.length === 0 ? null : kyrubXpTotal(entries),
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/AUTH|TOKEN|ID_TOKEN/i.test(message)) {
        response.status(401).json({ error: 'AUTH_INVALID' });
      } else {
        console.error('[kairubi-xp-total]', message);
        response.status(503).json({ error: 'XP_UNAVAILABLE' });
      }
    }
    return;
  }

  if (transport === 'selos-kairubi-balance') {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    const authorization = headerValue(request.headers.authorization ?? request.headers.Authorization);
    const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
    if (!token) {
      response.status(401).json({ error: 'AUTH_REQUIRED' });
      return;
    }
    try {
      const [{ verifyFirebaseIdToken }, { adminDb }, gamification] = await Promise.all([
        import('../server/ai/consultantAuth.js'),
        import('../server/firebaseAdmin.js'),
        import('../shared/gamification.js'),
      ]);
      const actor = await verifyFirebaseIdToken(token);
      const snapshot = await adminDb.collection(`users/${actor.uid}/rewardLedger`).get();
      const entries = snapshot.docs.map(document => {
        const entry = document.data() as import('../shared/gamification.js').KyrubRewardLedgerEntry;
        if (entry.userId !== actor.uid || entry.id !== document.id) throw new Error('REWARD_LEDGER_SCOPE_INVALID');
        return gamification.assertKyrubRewardLedgerEntry(entry);
      });
      response.status(200).json({
        schemaVersion: 1,
        unit: 'selos_kairubi',
        balance: gamification.kyrubKCoinBalance(entries),
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/AUTH|TOKEN|ID_TOKEN/i.test(message)) {
        response.status(401).json({ error: 'AUTH_INVALID' });
      } else {
        console.error('[selos-kairubi-balance]', message);
        response.status(503).json({ error: 'BALANCE_UNAVAILABLE' });
      }
    }
    return;
  }

  if (transport === 'mcp') {
    await handleKyrubMcpRequest(request, response);
    return;
  }

  if (transport === 'kyrubia-bridge') {
    try {
      const bridge = await import('../server/mcp/kyrubiaBridgeServerlessTransport.js');
      await bridge.handleKyrubiaBridgeServerlessRequest(request, response);
    } catch (error) {
      console.error('[kyrubia-bridge-transport]', JSON.stringify({
        requestId: traceId,
        error: error instanceof Error ? error.message : 'unknown',
      }));
      response.setHeader('X-Kyrub-Decision', 'kyrubia_bridge_transport_error');
      response.status(503).json({
        error: 'A ponte externa da Kyrubia está temporariamente indisponível.',
        code: 'KYRUBIA_BRIDGE_TRANSPORT_UNAVAILABLE',
        requestId: traceId,
      });
    }
    return;
  }

  if (transport === 'kyrubia-user-ai-chat') {
    console.info('[kyrubia-user-ai-chat-entry]', JSON.stringify({
      requestId: traceId,
      release: releaseIdentifier(),
      transport,
      method: request.method?.toUpperCase() || 'GET',
    }));

    const genericConfirmation = resolveKyrubiaMercadoLivreGenericConfirmationGuard(
      request.body
    );
    if (genericConfirmation) {
      console.info('[kyrubia-mercado-livre-generic-confirmation-blocked]', JSON.stringify({
        requestId: traceId,
        release: releaseIdentifier(),
        decision: 'mercado_livre_generic_confirmation_blocked',
      }));
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('X-Kyrub-Route', 'kyrubia-user-ai-chat');
      response.setHeader('X-Kyrub-Decision', 'mercado_livre_generic_confirmation_blocked');
      response.status(200).json({
        status: 'deterministic',
        reply: genericConfirmation.reply,
        provider: 'kyrub',
        model: 'kyrub-runtime-v1',
        mode: 'deterministic',
        requestId: traceId,
        turnContext: genericConfirmation.turnContext,
        capabilities: {
          actionsEnabled: true,
          enabledActions: ['create_note'],
          enabledReadActions: [
            'read_store_summary',
            'list_products',
            'list_low_stock_products',
            'list_pending_orders',
          ],
          voiceEnabled: false,
          persistentCloudHistoryEnabled: false,
          multimodalAttachmentsEnabled: false,
          providerResilienceEnabled: false,
          usageMeteringEnabled: true,
        },
        funding: 'none',
        usage: {},
      });
      return;
    }

    try {
      const chat = await import('../server/ai/kyrubiaUserAiChatServerlessTransport.js');
      await chat.handleKyrubiaUserAiChatServerlessRequest(request, response);
    } catch (error) {
      console.error('[kyrubia-user-ai-chat-transport]', JSON.stringify({
        requestId: traceId,
        error: error instanceof Error ? error.message : 'unknown',
      }));
      response.setHeader('X-Kyrub-Decision', 'kyrubia_user_ai_chat_transport_error');
      response.status(503).json({
        error: 'A conversa da Kyrubia está temporariamente indisponível.',
        code: 'KYRUBIA_USER_AI_CHAT_TRANSPORT_UNAVAILABLE',
        requestId: traceId,
      });
    }
    return;
  }

  if (transport === 'public-storefront') {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Kyrub-Route', 'public-storefront');

    if ((request.method?.toUpperCase() || 'GET') !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(405).json({ error: 'Método não permitido.' });
      return;
    }

    const slug = queryValue(request.query?.slug).trim();
    if (!slug) {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(400).json({ error: 'Identificador da vitrine não informado.' });
      return;
    }

    try {
      const storefront = await import(
        '../server/payments/marketplaceDiscoveryService.js'
      );
      const result = await storefront.loadPublicStorefrontBySlug(slug);
      if (!result) {
        response.setHeader('Cache-Control', 'no-store, max-age=0');
        response.status(404).json({
          error: 'Vitrine não encontrada ou ainda não publicada.',
        });
        return;
      }

      response.setHeader(
        'Cache-Control',
        'public, max-age=20, stale-while-revalidate=60'
      );
      response.status(200).json(result);
    } catch (error) {
      console.error(
        '[public-storefront-transport]',
        error instanceof Error ? error.message : String(error)
      );
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(503).json({
        error: 'A vitrine está temporariamente indisponível.',
        code: 'PUBLIC_STOREFRONT_TRANSPORT_UNAVAILABLE',
        requestId: traceId,
      });
    }
    return;
  }

  if (transport === 'local-attendance') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      const localAttendance = await import(
        '../server/attendance/localAttendanceServerlessTransport.js'
      );
      await localAttendance.handleLocalAttendanceServerlessRequest(
        request,
        response
      );
    } catch (error) {
      console.error(
        '[local-attendance-transport]',
        error instanceof Error ? error.message : String(error)
      );
      if (!(response as unknown as { writableEnded?: boolean }).writableEnded) {
        response.status(503).json({
          error: 'O atendimento local está temporariamente indisponível.',
          code: 'LOCAL_ATTENDANCE_TRANSPORT_UNAVAILABLE',
        });
      }
    }
    return;
  }

  if (transport === 'user-notifications') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      const notifications = await import(
        '../server/notifications/userNotificationsServerlessTransport.js'
      );
      await notifications.handleUserNotificationsServerlessRequest(request, response);
    } catch (error) {
      console.error('[user-notifications-transport]', error instanceof Error ? error.message : String(error));
      if (!(response as unknown as { writableEnded?: boolean }).writableEnded) {
        response.status(503).json({ error: 'Serviço de notificações indisponível.', code: 'USER_NOTIFICATIONS_TRANSPORT_UNAVAILABLE' });
      }
    }
    return;
  }

  if (transport === 'store-promotions') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      const storePromotions = await import(
        '../server/payments/storePromotionServerlessTransport.js'
      );
      await storePromotions.handleStorePromotionServerlessRequest(
        request,
        response
      );
    } catch (error) {
      console.error(
        '[store-promotions-transport]',
        error instanceof Error ? error.message : String(error)
      );
      if (!(response as unknown as { writableEnded?: boolean }).writableEnded) {
        response.status(503).json({
          error: 'Não foi possível administrar os cupons agora.',
          code: 'STORE_PROMOTIONS_TRANSPORT_UNAVAILABLE',
        });
      }
    }
    return;
  }

  if (transport === 'store-connections') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      const storeConnections = await import(
        '../server/integrations/storeConnectionsServerlessTransport.js'
      );
      await storeConnections.handleStoreConnectionsServerlessRequest(
        request,
        response
      );
    } catch (error) {
      console.error(
        '[store-connections-transport]',
        error instanceof Error ? error.message : String(error)
      );
      response.status(503).json({
        error: 'A integração de canais está temporariamente indisponível.',
        code: 'STORE_CONNECTION_TRANSPORT_UNAVAILABLE',
      });
    }
    return;
  }

  if (transport === 'store-crm') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      const storeCrm = await import(
        '../server/payments/storeCrmServerlessTransport.js'
      );
      await storeCrm.handleStoreCrmServerlessRequest(request, response);
    } catch (error) {
      console.error(
        '[store-crm-transport]',
        error instanceof Error ? error.message : String(error)
      );
      if (!(response as unknown as { writableEnded?: boolean }).writableEnded) {
        response.status(503).json({
          error: 'O CRM está temporariamente indisponível.',
          code: 'STORE_CRM_TRANSPORT_UNAVAILABLE',
        });
      }
    }
    return;
  }

  if (transport === 'drive-media') {
    if ((request.method?.toUpperCase() || 'GET') !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.status(405).json({ error: 'Método não permitido.' });
      return;
    }
    try {
      const media = await import('../server/driveMediaProxy.js');
      await media.proxyPublicGoogleDriveImage(
        queryValue(request.query?.fileId),
        response as never
      );
    } catch (error) {
      console.error('[drive-media-transport]', error instanceof Error ? error.message : String(error));
      if (!(response as unknown as { writableEnded?: boolean }).writableEnded) {
        response.status(503).json({ error: 'A imagem está temporariamente indisponível.' });
      }
    }
    return;
  }

  if (transport === 'activity-events') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if ((request.method?.toUpperCase() || 'GET') !== 'POST') {
      response.status(405).json({
        error: 'Método não permitido.',
        code: 'METHOD_NOT_ALLOWED',
      });
      return;
    }
    try {
      const activity = await import(
        '../server/observability/kyrubActivityTransport.js'
      );
      const result = await activity.receiveAuthorizedKyrubActivityEvents(
        headerValue(request.headers.authorization ?? request.headers.Authorization),
        request.body
      );
      response.status(200).json(result);
    } catch (error) {
      console.warn('[activity-transport] rejected', error instanceof Error ? error.message : 'unknown');
      response.status(401).json({
        error: 'Não foi possível registrar a atividade desta sessão.',
        code: 'ACTIVITY_TRANSPORT_REJECTED',
      });
    }
    return;
  }

  if (transport === 'order-status-execute' || transport === 'pickup-code-read') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if ((request.method?.toUpperCase() || 'GET') !== 'POST') {
      response.status(405).json({
        error: 'Método não permitido.',
        code: 'METHOD_NOT_ALLOWED',
      });
      return;
    }

    const execution = await import(
      '../server/inventory/orderStatusExecutionService.js'
    );
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? { ...(request.body as Record<string, unknown>) }
      : {};
    body.orderId = queryValue(request.query?.orderId) || body.orderId;

    if (transport === 'pickup-code-read') {
      body.storeId = queryValue(request.query?.storeId) || body.storeId;
      const result = await execution.executeAuthorizedPickupCodeRead(
        headerValue(request.headers.authorization ?? request.headers.Authorization),
        body
      );
      console.info('[pickup-code-read]', JSON.stringify({
        orderId: safeLogIdentifier(body.orderId),
        storeId: safeLogIdentifier(body.storeId),
        httpStatus: result.status,
      }));
      response.status(result.status).json(result.body);
      return;
    }

    const result = await execution.executeAuthorizedOrderStatusTransition(
      headerValue(request.headers.authorization ?? request.headers.Authorization),
      body
    );
    console.info('[order-status]', JSON.stringify({
      orderId: safeLogIdentifier(body.orderId),
      nextStatus: safeLogIdentifier(body.status),
      httpStatus: result.status,
    }));
    response.status(result.status).json(result.body);
    return;
  }

  const method = request.method?.toUpperCase() || 'GET';

  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (method !== 'GET') {
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  response.status(200).json(buildKyrubHealthPayload());
}
