import {auth} from './firebase';
export function storeReputationCandidateEnabled(){
 return import.meta.env?.DEV===true&&import.meta.env.VITE_KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&import.meta.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_TEST_ONLY==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_INDEX_TEST_ONLY==='true'&&auth.app.options.projectId==='kyrub-security-test'&&typeof window!=='undefined'&&['localhost','127.0.0.1'].includes(window.location.hostname);
}
