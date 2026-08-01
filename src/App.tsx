import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import LegacyApp from './LegacyApp';
import AdminControlPlaneRoot from './components/admin/AdminControlPlaneRoot';
import { AppModalLayoutBridge } from './components/AppModalLayoutBridge';
import { KyrubAiConversationHeaderGuard } from './components/KyrubAiConversationHeaderGuard';
import { KyrubAiNoteActionBridge } from './components/KyrubAiNoteActionBridge';
import { KyrubAiWorkspaceBridge } from './components/KyrubAiWorkspaceBridge';
import { KyrubiaNamingBridge } from './components/KyrubiaNamingBridge';
import { NoteInvitationOutboxBridge } from './components/NoteInvitationOutboxBridge';
import { ProfileConnectedCardOrganizationBridge } from './components/ProfileConnectedCardOrganizationBridge';
import { ProfileConnectedGroupsBridge } from './components/ProfileConnectedGroupsBridge';
import { ProfilePasskeyBridge } from './components/ProfilePasskeyBridge';
import { ProfileSocialHubBridge } from './components/ProfileSocialHubBridge';
import { ProfileSocialMobileFirstBridge } from './components/ProfileSocialMobileFirstBridge';
import { ProfileSocialPolishBridge } from './components/ProfileSocialPolishBridge';
import { ProfileSocialPostActionsBridge } from './components/ProfileSocialPostActionsBridge';
import { ProfileStatusCheckboxBridge } from './components/ProfileStatusCheckboxBridge';
import { ProfileVerificationBridge } from './components/ProfileVerificationBridge';
import { PublicStorefrontApp } from './components/PublicStorefrontApp';
import { SocialPublishingBridge } from './components/SocialPublishingBridge';
import { IntegrationTestOrderBridge } from './components/store/IntegrationTestOrderBridge';
import { KyrubDeliveryOpportunityBridge } from './components/store/KyrubDeliveryOpportunityBridge';
import { KyrubDeliveryStatusSyncBridge } from './components/store/KyrubDeliveryStatusSyncBridge';
import { NinetyNineFoodConnectionBridge } from './components/store/NinetyNineFoodConnectionBridge';
import { NinetyNineFoodOrderStatusBridge } from './components/store/NinetyNineFoodOrderStatusBridge';
import { OperationalAppEntryBridge } from './components/store/OperationalAppEntryBridge';
import { OrderInventoryReconciliationBridge } from './components/store/OrderInventoryReconciliationBridge';
import { ProductCrossDeviceSyncBridge } from './components/store/ProductCrossDeviceSyncBridge';
import { ProductWorkspaceLayoutBridge } from './components/store/ProductWorkspaceLayoutBridge';
import { StoreRestartLandingBridge } from './components/store/StoreRestartLandingBridge';
import { StoreSharingPortalBridge } from './components/store/StoreSharingPortalBridge';
import { UnifiedProductCreateModalBridge } from './components/store/UnifiedProductCreateModalBridge';
import { useFontSizeAccessibility } from './hooks/useFontSizeAccessibility';
import { resolveKyrubAppRoute } from './utils/appRoutes';
import { isAdminControlPlaneLocation } from './utils/adminControlPlane';
import { auth, db } from './utils/firebase';
import { identityVerificationEnabled } from './utils/featureFlags';
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

function AuthenticatedKyrubApp({ operational }: { operational: boolean }) {
  const [legacyCacheRevision, setLegacyCacheRevision] = useState(0);
  const refreshLegacyCache = useCallback(
    () => setLegacyCacheRevision(current => current + 1),
    []
  );

  return (
    <>
      <AppModalLayoutBridge />
      <KyrubAiConversationHeaderGuard />
      <StorePersistenceBridge />
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
      <NinetyNineFoodConnectionBridge />
      <NinetyNineFoodOrderStatusBridge />
      <NoteInvitationOutboxBridge />
      <SocialPublishingBridge />
      <ProfileSocialHubBridge />
      {identityVerificationEnabled && (
        <>
          <ProfileVerificationBridge />
          <ProfilePasskeyBridge />
        </>
      )}
      <ProfileSocialPolishBridge />
      <ProfileStatusCheckboxBridge />
      <ProfileSocialMobileFirstBridge />
      <ProfileConnectedGroupsBridge />
      <ProfileConnectedCardOrganizationBridge />
      <ProfileSocialPostActionsBridge />
      <KyrubAiWorkspaceBridge />
      <KyrubiaNamingBridge />
      <KyrubAiNoteActionBridge />
      <StoreSharingPortalBridge />
      <StoreRestartLandingBridge />
      <UnifiedProductCreateModalBridge />
      <ProductWorkspaceLayoutBridge />
      {operational && <OperationalAppEntryBridge />}
      <LegacyApp key={`legacy-cache-${legacyCacheRevision}`} />
    </>
  );
}

export default function App() {
  useFontSizeAccessibility();

  const adminControlPlane = isAdminControlPlaneLocation(
    window.location.hostname,
    window.location.pathname
  );

  if (adminControlPlane) return <AdminControlPlaneRoot />;

  const route = resolveKyrubAppRoute(window.location.pathname);

  if (route.kind === 'public-storefront') {
    return <PublicStorefrontApp slug={route.slug} />;
  }

  if (route.kind === 'staff-app' && route.legacyRedirect) {
    window.history.replaceState({}, '', route.canonicalPath);
  }

  return <AuthenticatedKyrubApp operational={route.kind === 'staff-app'} />;
}
