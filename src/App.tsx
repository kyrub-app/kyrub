import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
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
import { KyrubiaNamingBridge } from './components/KyrubiaNamingBridge';
import { NoteInvitationOutboxBridge } from './components/NoteInvitationOutboxBridge';
import { PlanCenterApp } from './components/plans/PlanCenterApp';
import { ProfileIdentityRecoveryBridge } from './components/ProfileIdentityRecoveryBridge';
import { ProfilePasskeyBridge } from './components/ProfilePasskeyBridge';
import { ProfilePlanCenterBridge } from './components/ProfilePlanCenterBridge';
import { ProfilePostInteractionsBridge } from './components/ProfilePostInteractionsBridge';
import { ProfileRecoveredActionsBridge } from './components/ProfileRecoveredActionsBridge';
import { ProfileSocialHubNative } from './components/ProfileSocialHubNative';
import { ProfileVerificationBridge } from './components/ProfileVerificationBridge';
import { PublicStorefrontApp } from './components/PublicStorefrontApp';
import { SocialPublishingBridge } from './components/SocialPublishingBridge';
import { CatalogCustomizationInheritanceBridge } from './components/store/CatalogCustomizationInheritanceBridge';
import { CourierLiveTrackingBridge } from './components/store/CourierLiveTrackingBridge';
import { IntegrationTestOrderBridge } from './components/store/IntegrationTestOrderBridge';
import { KyrubDeliveryOpportunityBridge } from './components/store/KyrubDeliveryOpportunityBridge';
import { KyrubDeliveryStatusSyncBridge } from './components/store/KyrubDeliveryStatusSyncBridge';
import { ManualStorePromotionBridge } from './components/store/ManualStorePromotionBridge';
import { NinetyNineFoodConnectionBridge } from './components/store/NinetyNineFoodConnectionBridge';
import { NinetyNineFoodOrderStatusBridge } from './components/store/NinetyNineFoodOrderStatusBridge';
import { OperationalAppEntryBridge } from './components/store/OperationalAppEntryBridge';
import { OrderInventoryReconciliationBridge } from './components/store/OrderInventoryReconciliationBridge';
import { ProductCrossDeviceSyncBridge } from './components/store/ProductCrossDeviceSyncBridge';
import { ProductWorkspaceLayoutBridge } from './components/store/ProductWorkspaceLayoutBridge';
import { StoreCrmRelationshipBridge } from './components/store/StoreCrmRelationshipBridge';
import { StoreLoyaltyCenterBridge } from './components/store/StoreLoyaltyCenterBridge';
import { StoreRestartLandingBridge } from './components/store/StoreRestartLandingBridge';
import { StoreSharingPortalBridge } from './components/store/StoreSharingPortalBridge';
import { UnifiedProductCreateModalBridge } from './components/store/UnifiedProductCreateModalBridge';
import { useFontSizeAccessibility } from './hooks/useFontSizeAccessibility';
import { KyrubAuthoritativeReceiptBridge } from './observability/KyrubAuthoritativeReceiptBridge';
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
      <KyrubiaNamingBridge />
      <KyrubAiNoteActionBridge />
      <KyrubAiTaskActionBridge />
      <KyrubAiProductUpdateActionBridge />
      <KyrubAiInventoryActionBridge />
      <KyrubAiProductCompositionActionBridge />
      <KyrubAiOrderStatusActionBridge />
      <KyrubAiStoreOperationActionBridge />
      <KyrubAiStorePromotionActionBridge />
      <ManualStorePromotionBridge />
      <StoreLoyaltyCenterBridge />
      <StoreCrmRelationshipBridge />
      <StoreSharingPortalBridge />
      <StoreRestartLandingBridge />
      <UnifiedProductCreateModalBridge />
      <CatalogCustomizationInheritanceBridge />
      <ProductWorkspaceLayoutBridge />
      {operational && <OperationalAppEntryBridge />}
      <LegacyApp key={`legacy-cache-${legacyCacheRevision}`} />
      {legacyRefreshing && <KyrubBootstrapScreen />}
    </>
  );
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

  if (route.kind === 'staff-app' && route.legacyRedirect) {
    window.history.replaceState({}, '', route.canonicalPath);
  }

  return <AuthenticatedKyrubApp operational={route.kind === 'staff-app'} />;
}
