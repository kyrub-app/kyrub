/**
 * Keep Firestore-backed community views tied to the currently selected
 * identity. Snapshot callbacks may temporarily contain records from a
 * previous community while the replacement listener initializes.
 */
export const scopeCommunityRecords = <T extends { communityId: string }>(
  records: readonly T[],
  communityId: string
): T[] =>
  communityId ? records.filter(record => record.communityId === communityId) : [];

export const scopeDebateComments = <T extends { communityId: string; debateId: string }>(
  records: readonly T[],
  communityId: string,
  debateId: string
): T[] =>
  communityId && debateId
    ? records.filter(record =>
        record.communityId === communityId && record.debateId === debateId
      )
    : [];
