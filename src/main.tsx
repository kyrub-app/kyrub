import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ProfileConnectedCardsLayoutBridge } from './components/ProfileConnectedCardsLayoutBridge';
import { ProfileConnectedCardsPolishBridge } from './components/ProfileConnectedCardsPolishBridge';
import { ProfileConnectedNameTopBridge } from './components/ProfileConnectedNameTopBridge';
import { ProfileNextPolishBridge } from './components/ProfileNextPolishBridge';
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
        <ProfileConnectedCardsLayoutBridge />
        <ProfileConnectedNameTopBridge />
        <App />
      </>
    </AppErrorBoundary>
  </StrictMode>
);
