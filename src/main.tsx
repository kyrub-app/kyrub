import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { OfficialKnowledgeSemanticSetupBridge } from './components/OfficialKnowledgeSemanticSetupBridge';
import { OfficialKnowledgeSetupBridge } from './components/OfficialKnowledgeSetupBridge';
import { ProfileCommunitiesCloudBridge } from './components/ProfileCommunitiesCloudBridge';
import { ProfileConnectedCardsPolishBridge } from './components/ProfileConnectedCardsPolishBridge';
import { ProfileConnectedImageFitBridge } from './components/ProfileConnectedImageFitBridge';
import { ProfileContactGroupsPolishBridge } from './components/ProfileContactGroupsPolishBridge';
import { ProfileNextPolishBridge } from './components/ProfileNextPolishBridge';
import { ProfileOffersFiltersBridge } from './components/ProfileOffersFiltersBridge';
import { ProfilePublishingDestinationsCloudBridge } from './components/ProfilePublishingDestinationsCloudBridge';
import './index.css';
import './styles/responsive-product-cards.css';
import './styles/catalog-category-tree.css';
import './styles/profile-verification.css';
import './styles/profile-header-layout.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Kyrub root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <>
        <ProfileNextPolishBridge />
        <ProfileConnectedCardsPolishBridge />
        <ProfileConnectedImageFitBridge />
        <ProfileContactGroupsPolishBridge />
        <ProfileOffersFiltersBridge />
        <ProfilePublishingDestinationsCloudBridge />
        <ProfileCommunitiesCloudBridge />
        <OfficialKnowledgeSetupBridge />
        <OfficialKnowledgeSemanticSetupBridge />
        <App />
      </>
    </AppErrorBoundary>
  </StrictMode>
);
