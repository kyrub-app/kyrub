import { auth } from './firebase';

export interface MyStoreClubCandidate {
  storeId: string;
  pointsBalance: number;
  activeVouchers: number;
  redeemableRewards: number;
}

export interface MyClubsCandidateResponse {
  schemaVersion: 1;
  clubs: MyStoreClubCandidate[];
  checkedStores: number;
  /** False: the caller supplies bounded candidates; this is not a full club index. */
  complete: false;
}

export const loadMyClubCandidates = async (
  storeIds: readonly string[]
): Promise<MyClubsCandidateResponse> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login para consultar seus clubes.');
  if (storeIds.length > 12) throw new Error('Consulte até 12 lojas por vez.');
  const token = await user.getIdToken();
  const response = await fetch('/api/my-clubs/candidates', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ storeIds }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Não foi possível consultar seus clubes.');
  return response.json() as Promise<MyClubsCandidateResponse>;
};
