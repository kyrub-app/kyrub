import { adminDb } from '../firebaseAdmin.js';
import { canReserveSocialAddress, isDocumentId, isSocialAddress, matchesSocialAddressRecord, projectSocialAddress, type SocialAddressRecord, type SocialDestinationKind } from './publicSocialAddressPolicy.js';

// Server-owned indices: one immutable reservation per source and per namespace.
// No duplication of user/community data. No client reads or writes to the index.
const addresses = () => adminDb.collection('public_social_addresses');
const reverse = () => adminDb.collection('public_social_address_targets');
const sourceRef = (kind: SocialDestinationKind, id: string) =>
  adminDb.collection(kind === 'profile' ? 'users' : 'communities').doc(id);
const addressKey = (kind: SocialDestinationKind, identifier: string) => kind + ':' + identifier;
const targetKey = (kind: SocialDestinationKind, id: string) => kind + ':' + id;

export async function reserveSocialAddress(actor: string, kind: SocialDestinationKind, identifier: string, communityId?: string) {
  const targetId = kind === 'profile' ? actor : communityId;
  if (!isSocialAddress(kind,identifier) || !isDocumentId(actor) || !isDocumentId(targetId)) throw Error('INVALID_PUBLIC_ADDRESS');
  return adminDb.runTransaction(async tx => {
    const source = sourceRef(kind,targetId);
    const address = addresses().doc(addressKey(kind,identifier));
    const target = reverse().doc(targetKey(kind,targetId));
    const [sourceDoc,addressDoc,targetDoc] = await Promise.all([tx.get(source),tx.get(address),tx.get(target)]);
    if (!canReserveSocialAddress(kind,actor,targetId,sourceDoc.data())) throw Error('PUBLIC_ADDRESS_FORBIDDEN');
    if (addressDoc.exists || targetDoc.exists) {
      if (matchesSocialAddressRecord(addressDoc.data(),kind,identifier,targetId) &&
          matchesSocialAddressRecord(targetDoc.data(),kind,identifier,targetId))
        return {kind,identifier};
      throw Error('PUBLIC_ADDRESS_CONFLICT');
    }
    const record: SocialAddressRecord = {kind,identifier,targetId};
    tx.create(address,record);
    tx.create(target,record);
    return {kind,identifier};
  });
}
export async function resolveSocialAddress(kind: SocialDestinationKind, identifier: string) {
  if (!isSocialAddress(kind,identifier)) return null;
  // Read the reservation and live source from one consistent snapshot, fail closed.
  return adminDb.runTransaction(async tx => {
    const mapping = (await tx.get(addresses().doc(addressKey(kind,identifier)))).data();
    if (!mapping || mapping.kind !== kind || mapping.identifier !== identifier || !isDocumentId(mapping.targetId)) return null;
    const target = (await tx.get(reverse().doc(targetKey(kind,mapping.targetId)))).data();
    if (!matchesSocialAddressRecord(target,kind,identifier,mapping.targetId)) return null;
    const ref = sourceRef(kind,mapping.targetId);
    const source = (await tx.get(ref)).data();
    if (!source) return null;
    const profile = kind === 'profile' && source.isProfileVisible === true
      ? (await tx.get(ref.collection('public_profile').doc('main'))).data() : undefined;
    return projectSocialAddress({kind,identifier,targetId:mapping.targetId},source,profile);
  },{readOnly:true});
}

export async function getOwnedSocialAddress(actor: string, kind: SocialDestinationKind, communityId?: string) {
  const targetId = kind === 'profile' ? actor : communityId;
  if (!isDocumentId(actor) || !isDocumentId(targetId)) throw Error('INVALID_PUBLIC_ADDRESS');
  return adminDb.runTransaction(async tx => {
    const source = (await tx.get(sourceRef(kind,targetId))).data();
    if (!source || (kind === 'profile' ? actor !== targetId : source.ownerId !== actor))
      throw Error('PUBLIC_ADDRESS_FORBIDDEN');
    const record = (await tx.get(reverse().doc(targetKey(kind,targetId)))).data();
    let identifier: string | null = null;
    if (record) {
      if (typeof record.identifier !== 'string' ||
          !matchesSocialAddressRecord(record,kind,record.identifier,targetId)) throw Error('PUBLIC_ADDRESS_CONFLICT');
      const forward = (await tx.get(addresses().doc(addressKey(kind,record.identifier)))).data();
      if (!matchesSocialAddressRecord(forward,kind,record.identifier,targetId)) throw Error('PUBLIC_ADDRESS_CONFLICT');
      identifier = record.identifier;
    }
    return {identifier, eligible: canReserveSocialAddress(kind,actor,targetId,source),
      publiclyVisible: kind === 'profile' ? source.isProfileVisible === true : source.visibility === 'public' || source.visibility === 'moderated'};
  },{readOnly:true});
}
