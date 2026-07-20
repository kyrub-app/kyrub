const KYRUB_FIRESTORE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const KYRUB_FIRESTORE_ID_MAX_LENGTH = 128;

const validateKyrubFirestoreId = (id: string): string => {
  if (typeof id !== 'string') {
    throw new TypeError('Firestore ID must be a valid string.');
  }

  if (
    id.length === 0 ||
    id.length > KYRUB_FIRESTORE_ID_MAX_LENGTH ||
    !KYRUB_FIRESTORE_ID_PATTERN.test(id)
  ) {
    throw new Error('Invalid Firestore ID.');
  }

  return id;
};

export const getPrimaryUserStoreId = (uid: string): string =>
  validateKyrubFirestoreId(uid);

export const getUserStoresCollectionPath = (uid: string): string => {
  const validUid = validateKyrubFirestoreId(uid);
  return `users/${validUid}/stores`;
};

export const getPrimaryUserStoreDocumentPath = (uid: string): string => {
  const validUid = validateKyrubFirestoreId(uid);
  return `users/${validUid}/stores/${validUid}`;
};
