import { useEffect } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { readOfficialCommunityKnowledge } from './officialCommunityKnowledge';
import {
  clearOfficialKnowledgeRuntimeSnapshot,
  getOfficialKnowledgeRuntimeSnapshot,
  setOfficialKnowledgeRuntimeSnapshot,
} from './officialKnowledgeRuntimeCache';

const REFRESH_INTERVAL_MS = 4 * 60_000;

export function KyrubOfficialKnowledgeRuntimeBridge() {
  useEffect(() => {
    let active = true;
    let refreshVersion = 0;
    let lastUid = '';

    const refresh = async (user: User, force = false): Promise<void> => {
      const version = ++refreshVersion;
      if (!force && getOfficialKnowledgeRuntimeSnapshot().length > 0) return;

      try {
        const snapshot = await readOfficialCommunityKnowledge();
        if (!active || version !== refreshVersion) return;

        // A successful empty read is a valid truth state. A read that failed
        // with warnings does not overwrite a still-valid runtime snapshot.
        if (snapshot.items.length > 0 || snapshot.warnings.length === 0) {
          setOfficialKnowledgeRuntimeSnapshot(snapshot);
        }
      } catch (error) {
        console.warn(
          '[Kyrubia] Official knowledge runtime refresh is unavailable.',
          error
        );
      }
    };

    const unsubscribe = onAuthStateChanged(auth, user => {
      const nextUid = user?.uid ?? '';
      if (!user) {
        lastUid = '';
        refreshVersion += 1;
        clearOfficialKnowledgeRuntimeSnapshot();
        return;
      }

      if (lastUid && lastUid !== nextUid) {
        clearOfficialKnowledgeRuntimeSnapshot();
      }
      lastUid = nextUid;
      void refresh(user);
    });

    const interval = window.setInterval(() => {
      const user = auth.currentUser;
      if (!user) return;
      void refresh(user, true);
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      refreshVersion += 1;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, []);

  return null;
}
