import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import LegacyApp from './LegacyApp';
import AdminControlPlaneRoot from './components/admin/AdminControlPlaneRoot';
import { AppModalLayoutBridge } from './components/AppModalLayoutBridge';
import { KyrubAiConversationHeaderGuard } from './components/KyrubAiConversationHeaderGuard';
import { KyrubAiInventoryActionBridge } from './components/KyrubAiInventoryActionBridge';
import { KyrubAiNoteActionBridge } from './components/KyrubAiNoteActionBridge';
import { KyrubAiOrderStatusActionBridge } from './components/KyrubAiOrderStatusActionBridge';
import { KyrubAiProductCompositionActionBridge } from './components/KyrubAiProductCompositionActionBridge';
import { KyrubAiProviderSettingsBridge } from './components/KyrubAiProviderSettingsBridge';
import { KyrubAiProductUpdateActionBridge } from './components/KyrubAiProductUpdateActionBridge';
import { KyrubAiStoreOperationActionBridge } from './components/KyrubAiStoreOperationActionBridge';
import { KyrubAiStorePromotionActionBridge } from './components/KyrubAiStorePromotionActionBridge';
import { KyrubAiTaskActionBridge } from './components/KyrubAiTaskActionBridge';
import { KyrubAiWorkspaceBridge } from './components/KyrubAiWorkspaceBridge';
import { KyrubiaExternalBridgeControls } from './components/KyrubiaExternalBridgeControls';
import { KyrubiaNamingBridge } from './components/KyrubiaNamingBridge';
import { KyrubRendaEntryApp } from './components/KyrubRendaEntryApp';
import { KyrubGuestWorkspace } from './components/KyrubGuestWorkspace';
import { KyrubTagOnlyEntry } from './components/KyrubTagOnlyEntry';
import { NoteInvitationOutboxBridge } from './components/NoteInvitationOutboxBridge';
import { PlanCenterApp } from './components/plans/PlanCenterApp';
import { ProfileIdentityRecoveryBridge } from './components/ProfileIdentityRecoveryBridge';
import { ProfilePasskeyBridge } from './components/ProfilePasskeyBridge';
import { ProfilePlanCenterBridge } from './components/ProfilePlanCenterBridge';
import { ProfilePostInteractionsBridge } from './components/ProfilePostInteractionsBridge';
import { ProfileRecoveredActionsBridge } from './components/ProfileRecoveredActionsBridge';
import { ProfileSocialHubNative } from './components/ProfileSocialHubNative';
import { ProfileVerificationBridge } from './components/ProfileVerificationBridge';
import { PublicKyrubTagPage } from './components/PublicKyrubTagPage';
import { PublicVisitCardPage } from './components/PublicVisitCardPage';
import { PublicSocialDestinationPage } from './components/PublicSocialDestinationPage';
import { PublicStorefrontApp } from './components/PublicStorefrontApp';
import { SocialPublishingBridge } from './components/SocialPublishingBridge';
import { StorefrontReturnBridge } from './components/StorefrontReturnBridge';
import { UserNotificationCenterBridge } from './components/UserNotificationCenterBridge';
import { CatalogCustomizationInheritanceBridge } from './components/store/CatalogCustomizationInheritanceBridge';
import { CourierLiveTrackingBridge } from './components/store/CourierLiveTrackingBridge';
import { IntegrationTestOrderBridge } from './components/store/IntegrationTestOrderBridge';
import { KyrubDeliveryOpportunityBridge } from './components/store/KyrubDeliveryOpportunityBridge';
import { KyrubDeliveryStatusSyncBridge } from './components/store/KyrubDeliveryStatusSyncBridge';
import { LocalAttendanceBridge } from './components/store/LocalAttendanceBridge';
import { NinetyNineFoodConnectionBridge } from './components/store/NinetyNineFoodConnectionBridge';
import { NinetyNineFoodOrderStatusBridge } from './components/store/NinetyNineFoodOrderStatusBridge';
import { OperationalAppEntryBridge } from './components/store/OperationalAppEntryBridge';
import { OrderInventoryReconciliationBridge } from './components/store/OrderInventoryReconciliationBridge';
import { ProductCrossDeviceSyncBridge } from './components/store/ProductCrossDeviceSyncBridge';
import { StoreCrmRelationshipBridge } from './components/store/StoreCrmRelationshipBridge';
import { StoreCustomerChatBridge } from './components/store/StoreCustomerChatBridge';
import { StoreInstitutionalIdentityBridge } from './components/store/StoreInstitutionalIdentityBridge';
import { StoreLoyaltyCenterBridge } from './components/store/StoreLoyaltyCenterBridge';
import { StoreRestartLandingBridge } from './components/store/StoreRestartLandingBridge';
import { StoreSharingPortalBridge } from './components/store/StoreSharingPortalBridge';
import { UnifiedProductCreateModalBridge } from './components/store/UnifiedProductCreateModalBridge';
import { useFontSizeAccessibility } from './hooks/useFontSizeAccessibility';
import { KyrubAuthoritativeReceiptBridge } from './observability/KyrubAuthoritativeReceiptBridge';
import { isTagId } from '../shared/kyrubTagContract';
import { resolveKyrubAppRoute } from './utils/appRoutes';
import { isAdminControlPlaneLocation } from './utils/adminControlPlane';
import { auth, db } from './utils/firebase';
import { identityVerificationEnabled } from './utils/featureFlags';
import { isPlanCenterLocation } from './utils/planCenter';
import {
  hasPendingUserStoreSync,
  loadCachedUserStore,
  persistPrivateUserStore,
  saveCachedUserStore,
} from './utils/storePersistence';
import { getPrimaryUserStoreDocumentPath } from './utils/storePaths';

function StorePersistenceBridge() {
  useEffect(() => {
    let cancelled = false;
    let unsubscribeStore = () => undefined;
    let syncing = false;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeStore();
      unsubscribeStore = () => undefined;
      syncing = false;

      if (!user || cancelled) return;
      if (!hasPendingUserStoreSync(localStorage, user.uid)) return;

      const cachedStore = loadCachedUserStore(
        localStorage,
        user.uid,
        user.email ?? ''
      );
      if (!cachedStore) return;

      const storeReference = doc(
        db,
        getPrimaryUserStoreDocumentPath(user.uid)
      );

      // LegacyApp owns the initial create/read bootstrap for the private store.
      // Wait until that document is confirmed by the server before replaying an
      // offline pending update. This prevents two clients in the same page from
      // both observing a missing document and racing to create it.
      unsubscribeStore = onSnapshot(
        storeReference,
        { includeMetadataChanges: true },
        snapshot => {
          if (
            cancelled ||
            syncing ||
            !snapshot.exists() ||
            snapshot.metadata.fromCache
          ) {
            return;
          }

          syncing = true;
          void persistPrivateUserStore(user, cachedStore)
            .then(() => {
              if (cancelled) return;
              saveCachedUserStore(
                localStorage,
                user.uid,
                cachedStore,
                false
              );
              unsubscribeStore();
              unsubscribeStore = () => undefined;
            })
            .catch(error => {
              console.warn('Pending user store sync remains queued.', error);
            })
            .finally(() => {
              syncing = false;
            });
        },
        error => {
          console.warn('Primary user store bootstrap is unavailable.', error);
        }
      );
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeStore();
    };
  }, []);

  return null;
}

function KyrubBootstrapScreen() {
  return (
    <div
      id="kyrub-bootstrap-screen"
      className="fixed inset-0 z-[250] flex min-h-screen items-center justify-center bg-slate-950 text-white"
      aria-live="polite"
      aria-label="Carregando Kyrub"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-2xl border-2 border-orange-500/80 bg-orange-500/10" />
        <strong className="text-sm font-black uppercase tracking-[0.22em]">Kyrub</strong>
        <span className="font-mono text-[9px] uppercase tracking-widest text-slate-500">
          Restaurando sua sessão
        </span>
      </div>
    </div>
  );
}

// Reuse normal account bootstrap before returning to the original public tag.
function KyrubTagActivationReturn(){
 useEffect(()=>{
  const id=new URLSearchParams(window.location.search).get('tagActivation');
  const user=auth.currentUser;
  if(window.location.pathname!=='/'||!isTagId(id)||!user)return;
  return onSnapshot(doc(db,'users',user.uid),{includeMetadataChanges:true},snapshot=>{
   if(snapshot.exists()&&!snapshot.metadata.fromCache&&auth.currentUser?.uid===user.uid)window.location.replace('/tag/'+id);
  },()=>{});
 },[]);
 return null;
}

function AuthenticatedKyrubApp({ operational }: { operational: boolean }) {
  const [legacyCacheRevision, setLegacyCacheRevision] = useState(0);
  const [authResolved, setAuthResolved] = useState(false);
  const [legacyRefreshing, setLegacyRefreshing] = useState(true);

  const settleVisualBootstrap = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => setLegacyRefreshing(false), 120);
      });
    });
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      setAuthResolved(true);
      settleVisualBootstrap();
    });
    return unsubscribe;
  }, [settleVisualBootstrap]);

  const refreshLegacyCache = useCallback(() => {
    setLegacyRefreshing(true);
    setLegacyCacheRevision(current => current + 1);
    settleVisualBootstrap();
  }, [settleVisualBootstrap]);

  if (!authResolved) return <KyrubBootstrapScreen />;

  return (
    <>
      <AppModalLayoutBridge />
      <KyrubAiConversationHeaderGuard />
      <StorePersistenceBridge />
      <KyrubTagActivationReturn />
      <KyrubAuthoritativeReceiptBridge />
      <ProductCrossDeviceSyncBridge
        onCloudProductsApplied={refreshLegacyCache}
      />
      <IntegrationTestOrderBridge
        onTestOrderCreated={refreshLegacyCache}
      />
      <OrderInventoryReconciliationBridge />
      <KyrubDeliveryOpportunityBridge
        onOpportunitiesChanged={refreshLegacyCache}
      />
      <KyrubDeliveryStatusSyncBridge />
      <CourierLiveTrackingBridge />
      <NinetyNineFoodConnectionBridge />
      <NinetyNineFoodOrderStatusBridge />
      <NoteInvitationOutboxBridge />
      <SocialPublishingBridge />
      <ProfileIdentityRecoveryBridge />
      <ProfileSocialHubNative />
      <ProfilePostInteractionsBridge />
      <ProfileRecoveredActionsBridge />
      <ProfilePlanCenterBridge />
      {identityVerificationEnabled && (
        <>
          <ProfileVerificationBridge />
          <ProfilePasskeyBridge />
        </>
      )}
      <KyrubAiWorkspaceBridge />
      <KyrubAiProviderSettingsBridge />
      <KyrubiaExternalBridgeControls />
      <KyrubiaNamingBridge />
      <KyrubAiNoteActionBridge />
      <KyrubAiTaskActionBridge />
      <KyrubAiProductUpdateActionBridge />
      <KyrubAiInventoryActionBridge />
      <KyrubAiProductCompositionActionBridge />
      <KyrubAiOrderStatusActionBridge />
      <KyrubAiStoreOperationActionBridge />
      <KyrubAiStorePromotionActionBridge />
      <StoreLoyaltyCenterBridge />
      <StoreCrmRelationshipBridge />
      <LocalAttendanceBridge />
      <StoreInstitutionalIdentityBridge />
      <StoreCustomerChatBridge />
      <UserNotificationCenterBridge />
      <StoreSharingPortalBridge />
      <StoreRestartLandingBridge />
      <UnifiedProductCreateModalBridge />
      <CatalogCustomizationInheritanceBridge />
      {operational && <OperationalAppEntryBridge />}
      <StorefrontReturnBridge />
      <LegacyApp key={`legacy-cache-${legacyCacheRevision}`} />
      {legacyRefreshing && <KyrubBootstrapScreen />}
    </>
  );
}

function KyrubMainEntry({operational=false}:{operational?:boolean}={}) {
  // Promotional e-mail-only identities are checked before LegacyApp mounts.
  // No existing Kyrub account is affected until both server and client gates
  // are deliberately enabled for the new campaign.
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const [resolved, setResolved] = useState(false);
  const [identityMode, setIdentityMode] = useState<'checking'|'full'|'tag_only'|'unavailable'>('checking');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active=true;
    let controller:AbortController|null=null;
    const unsub=onAuthStateChanged(auth,user=>{
      controller?.abort();
      const ctrl=new AbortController();controller=ctrl;
      setCurrentUser(user);setResolved(true);
      if(!user||import.meta.env.VITE_KYRUB_TAG_MINIMAL_IDENTITY_GATE!=='true'){
        setIdentityMode('full');return;
      }
      setIdentityMode('checking');
      void user.getIdToken().then(token=>fetch('/api/health?transport=manage-kyrub-tag&view=identity',{
        cache:'no-store',signal:ctrl.signal,headers:{Authorization:'Bearer '+token}
      })).then(async response=>{
        if(!response.ok)throw Error('TAG_IDENTITY_UNAVAILABLE');
        const payload=await response.json() as {mode?:string};
        if(!active||ctrl.signal.aborted||auth.currentUser?.uid!==user.uid)return;
        setIdentityMode(payload.mode==='tag_only'?'tag_only':'full');
      }).catch(()=>{
        // If the tag identity service is unavailable, preserve existing Kyrub
        // members with a server-confirmed profile, but never bootstrap an
        // unclassified e-mail-only identity from a cache or an error.
        if(!active||ctrl.signal.aborted||auth.currentUser?.uid!==user.uid)return;
        void getDocFromServer(doc(db,'users',user.uid)).then(snapshot=>{
          if(active&&!ctrl.signal.aborted&&auth.currentUser?.uid===user.uid)
           setIdentityMode(snapshot.exists()?'full':'unavailable');
        }).catch(()=>{
          if(active&&!ctrl.signal.aborted&&auth.currentUser?.uid===user.uid)setIdentityMode('unavailable');
        });
      });
    });
    return()=>{active=false;controller?.abort();unsub();};
  },[retry]);

  if (!resolved || identityMode==='checking') return <KyrubBootstrapScreen />;
  if(currentUser&&(identityMode==='tag_only'||identityMode==='unavailable'))
   return <KyrubTagOnlyEntry user={currentUser}
      unavailable={identityMode==='unavailable'}
      onPromoted={()=>setIdentityMode('full')}
      onRetry={()=>setRetry(v=>v+1)}/>;
  return currentUser
    ? <AuthenticatedKyrubApp operational={operational} />
    : operational ? <AuthenticatedKyrubApp operational /> : <KyrubGuestWorkspace />;
}

export default function App() {
  useFontSizeAccessibility();

  const adminControlPlane = isAdminControlPlaneLocation(
    window.location.hostname,
    window.location.pathname
  );
  const planCenter = isPlanCenterLocation(
    window.location.hostname,
    window.location.pathname,
    window.location.search
  );

  if (adminControlPlane) return <AdminControlPlaneRoot />;
  if (planCenter) return <PlanCenterApp />;

  const route = resolveKyrubAppRoute(window.location.pathname);

  if (route.kind === 'public-storefront') {
    return <PublicStorefrontApp slug={route.slug} />;
  }

  if (route.kind === 'public-tag') return <PublicKyrubTagPage identifier={route.identifier} />;
  if (route.kind === 'public-card') return <PublicVisitCardPage identifier={route.identifier} />;

  if (route.kind === 'public-profile' || route.kind === 'public-community') {
    return <PublicSocialDestinationPage kind={route.kind === 'public-profile' ? 'profile' : 'community'} identifier={route.identifier} />;
  }
  if (route.kind === 'invalid-public-social') return <PublicSocialDestinationPage />;

  const searchParams = new URLSearchParams(window.location.search);
  const entry = searchParams.get('entry');

  // The former "Meu Kyrub / Comece por aqui" landing remains deliberately
  // accessible for the separately planned onboarding change, never the default.
  if (route.kind === 'default' && (entry === 'welcome' || entry === 'renda')) {
    return <KyrubRendaEntryApp />;
  }

  if (route.kind === 'staff-app') {
    if (route.legacyRedirect) {
      window.history.replaceState({}, '', route.canonicalPath);
    }
    // Tag-only Firebase sessions must never auto-create a Kyrub store even on /staff.
    // Preserve the original staff route when the campaign identity gate is off.
    return import.meta.env.VITE_KYRUB_TAG_MINIMAL_IDENTITY_GATE==='true'
      ? <KyrubMainEntry operational />
      : <AuthenticatedKyrubApp operational />;
  }

  // Root / and legacy ?app=1 both lead to the real workspace. Guests can
  // explore Renda/Praça before login; protected actions request an account.
  return <KyrubMainEntry />;
}
