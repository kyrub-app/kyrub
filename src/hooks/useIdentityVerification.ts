import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../utils/firebase';
import {
  IDENTITY_VERIFICATION_COLLECTION,
  mapIdentityVerification,
  workEligibility,
  type IdentityVerificationRecord,
  type WorkAction,
} from '../utils/identityVerification';

export function useIdentityVerification() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [record, setRecord] = useState<IdentityVerificationRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(auth.currentUser));

  useEffect(() => onAuthStateChanged(auth, nextUser => {
    setUser(nextUser);
    setRecord(null);
    setLoading(Boolean(nextUser));
  }), []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    return onSnapshot(
      doc(db, IDENTITY_VERIFICATION_COLLECTION, user.uid),
      snapshot => {
        setRecord(
          snapshot.exists()
            ? mapIdentityVerification(
                user.uid,
                snapshot.data() as Record<string, unknown>,
                user.displayName || ''
              )
            : null
        );
        setLoading(false);
      },
      () => {
        setRecord(null);
        setLoading(false);
      }
    );
  }, [user]);

  const eligibility = useMemo(
    () => (action: WorkAction) => workEligibility(record, action),
    [record]
  );

  return { user, record, loading, eligibility };
}
