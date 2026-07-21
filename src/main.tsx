import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {MobileErpMenuEnhancer} from './components/MobileErpMenuEnhancer';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <MobileErpMenuEnhancer />
  </StrictMode>,
);
