import { createRoot } from 'react-dom/client';
import AdminControlPlaneApp from '../../src/components/admin/AdminControlPlaneApp';

export let qaSession: any;
export const qaUser = { uid: '', email: 'superadmin@kyrub-qa.example.test', displayName: 'Super Admin de teste', getIdToken: async () => qaSession.token };
const query = new URLSearchParams(location.search);
const scenario = query.get('case') || 'normal';
const originalFetch = window.fetch.bind(window);
// Only this isolated bundle is instrumented. Product components and API client
// remain unchanged, and requests still reach the real administrative handler.
window.fetch = (input, init = {}) => {
  if (String(input).startsWith('/api/admin/global-challenges')) {
    return originalFetch(input, { ...init, headers: { ...init.headers, 'x-kyrub-qa-case': scenario } });
  }
  return originalFetch(input, init);
};
const response = await originalFetch(`/qa/session?case=${encodeURIComponent(scenario)}&run=${encodeURIComponent(query.get('run') || '')}`);
qaSession = await response.json();
qaUser.uid = qaSession.profile.uid;
createRoot(document.getElementById('root')!).render(<AdminControlPlaneApp />);
