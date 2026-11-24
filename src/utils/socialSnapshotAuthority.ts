/** A cached or locally pending Firestore snapshot is not proof of current
 * authorization. Social surfaces use this boundary before rendering data.
 * The caller must clear prior state on false, not simply ignore the snapshot.
 */
export function isConfirmedSocialSnapshot(metadata:{fromCache:boolean;hasPendingWrites:boolean},expectedUid:string|undefined,currentUid:string|undefined):boolean{
 return !!expectedUid&&expectedUid===currentUid&&!metadata.fromCache&&!metadata.hasPendingWrites;
}
