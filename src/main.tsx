import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AdminMercadoPagoOAuthBridge } from './components/admin/AdminMercadoPagoOAuthBridge';
import { GerencialIntegrationsNativeBridge } from './components/GerencialIntegrationsNativeBridge';
import { KyrubAiConversationCloudSyncGate } from './components/KyrubAiConversationCloudSyncGate';
import { OfficialKnowledgeSemanticSetupBridge } from './components/OfficialKnowledgeSemanticSetupBridge';
import { OfficialKnowledgeSetupBridge } from './components/OfficialKnowledgeSetupBridge';
import { BuyerPickupCodeBridge } from './components/store/BuyerPickupCodeBridge';
import { LocalServicePdvBridge } from './components/store/LocalServicePdvBridge';
import { MercadoLivreOAuthReturnBridge } from './components/store/MercadoLivreOAuthReturnBridge';
import { MercadoPagoReceivablesBridge } from './components/store/MercadoPagoReceivablesBridge';
import { PickupPdvNavigationBridge } from './components/store/PickupPdvNavigationBridge';
import { ServiceLocationOperationalWorkspaceBridge } from './components/store/ServiceLocationOperationalWorkspaceBridge';
import { StoreOwnedPixReceivablesBridge } from './components/store/StoreOwnedPixReceivablesBridge';
import { ProfileCommunitiesCloudBridge } from './components/ProfileCommunitiesCloudBridge';
import { ProfileConnectedCardsPolishBridge } from './components/ProfileConnectedCardsPolishBridge';
import { ProfileConnectedImageFitBridge } from './components/ProfileConnectedImageFitBridge';
import { ProfileContactGroupsPolishBridge } from './components/ProfileContactGroupsPolishBridge';
import { ProfileNextPolishBridge } from './components/ProfileNextPolishBridge';
import { ProfileOffersFiltersBridge } from './components/ProfileOffersFiltersBridge';
import { ProfilePublishingDestinationsCloudBridge } from './components/ProfilePublishingDestinationsCloudBridge';
import { KyrubOfficialKnowledgeRuntimeBridge } from './knowledge/KyrubOfficialKnowledgeRuntimeBridge';
import { KyrubActivityLogSetupBridge } from './observability/KyrubActivityLogSetupBridge';
import { KyrubActivityObserverBridge } from './observability/KyrubActivityObserverBridge';
import './index.css';
import './styles/responsive-product-cards.css';
import './styles/catalog-category-tree.css';
import './styles/profile-verification.css';
import './styles/profile-header-layout.css';
import './styles/retired-gerencial-route.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Kyrub root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <KyrubAiConversationCloudSyncGate>
        <>
          <ProfileNextPolishBridge />
          <ProfileConnectedCardsPolishBridge />
          <ProfileConnectedImageFitBridge />
          <ProfileContactGroupsPolishBridge />
          <ProfileOffersFiltersBridge />
          <ProfilePublishingDestinationsCloudBridge />
          <ProfileCommunitiesCloudBridge />
          <BuyerPickupCodeBridge />
          <LocalServicePdvBridge />
          <ServiceLocationOperationalWorkspaceBridge />
          <MercadoLivreOAuthReturnBridge />
          <PickupPdvNavigationBridge />
          <GerencialIntegrationsNativeBridge />
          <MercadoPagoReceivablesBridge />
          <StoreOwnedPixReceivablesBridge />
          <AdminMercadoPagoOAuthBridge />
          <KyrubOfficialKnowledgeRuntimeBridge />
          <KyrubActivityObserverBridge />
          <KyrubActivityLogSetupBridge />
          <OfficialKnowledgeSetupBridge />
          <OfficialKnowledgeSemanticSetupBridge />
          <App />
        </>
      </KyrubAiConversationCloudSyncGate>
    </AppErrorBoundary>
  </StrictMode>
);