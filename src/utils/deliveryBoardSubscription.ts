import {
  collection, doc, onSnapshot, or, query, where,
  type Firestore, type FirestoreError, type QuerySnapshot, type DocumentData,
} from 'firebase/firestore';

// Rebuild on approval/revocation. Participant queries require no courier approval.
export function subscribeAuthorizedDeliveryBoard(
  db: Firestore,
  uid: string,
  next: (snapshot: QuerySnapshot<DocumentData>) => void,
  error: (cause: FirestoreError) => void,
  reset: () => void = () => {},
): () => void {
  let stopJobs = () => {};
  let generation = 0;
  const subscribe = (approved: boolean) => {
    stopJobs();
    reset();
    const current = ++generation;
    const filters = [
      where('storeId', '==', uid),
      where('buyerId', '==', uid),
      where('acceptedBy', '==', uid),
    ];
    if (approved) filters.push(where('status', '==', 'available'));
    stopJobs = onSnapshot(
      query(collection(db, 'hub/renda/deliveries'), or(...filters)),
      snapshot => { if (current === generation) next(snapshot); },
      cause => { if (current === generation) error(cause); },
    );
  };
  subscribe(false);
  const stopProfile = onSnapshot(doc(db, 'identity_verifications', uid), snapshot => {
    const data = snapshot.data();
    const profiles: unknown = data?.approvedProfiles;
    subscribe(data?.status === 'approved' && Array.isArray(profiles)
      && profiles.some(profile => ['bicycle_courier', 'motorized_courier'].includes(profile)));
  }, () => subscribe(false));
  return () => { ++generation; stopProfile(); stopJobs(); };
}
