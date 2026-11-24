import { FieldPath, type DocumentData } from 'firebase-admin/firestore';
import { readReservedTribeNotificationScope } from '../identity/reservedTribeService.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  userNotificationPath,
  type UserNotification,
  type UserNotificationCategory,
  type UserNotificationTargetKind,
} from '../../shared/userNotifications.js';

export interface UserNotificationInbox {
  notifications: UserNotification[];
  unreadCount: number;
  personalBrowserNotificationsAllowed: boolean;
}

type NotificationDocument = {
  id: string;
  data(): DocumentData;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteIso = (value: unknown): string => {
  const normalized = clean(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : '';
};

const CATEGORIES = new Set<UserNotificationCategory>([
  'store_chat',
  'order',
  'loyalty',
  'marketing',
  'community_group_invite',
  'user_forward',
  'system',
]);
const TARGET_KINDS = new Set<UserNotificationTargetKind>([
  'store_chat',
  'storefront',
  'order',
  'community_group_invite',
  'community_post',
  'none',
]);

const parseNotification = (
  document: NotificationDocument,
  recipientUserId: string
): UserNotification => {
  const value = document.data() as Partial<UserNotification>;
  const target = value.target as Partial<UserNotification['target']> | undefined;
  if (
    value.schemaVersion !== 1 ||
    value.id !== document.id ||
    value.recipientUserId !== recipientUserId ||
    !CATEGORIES.has(value.category as UserNotificationCategory) ||
    !clean(value.eventType) ||
    !clean(value.sourceId) ||
    !clean(value.actorPrincipalId) ||
    !clean(value.title) ||
    typeof value.body !== 'string' ||
    !finiteIso(value.createdAt) ||
    (value.readAt !== '' && !finiteIso(value.readAt)) ||
    !target ||
    !TARGET_KINDS.has(target.kind as UserNotificationTargetKind) ||
    typeof target.storeId !== 'string' ||
    typeof target.customerId !== 'string' ||
    typeof target.orderId !== 'string' ||
    (target.kind === 'community_group_invite' &&
      (!clean(target.communityId) || !clean(target.groupId))) ||
    (target.kind === 'community_post' &&
      (!clean(target.communityId) || !clean(target.postId)))
  ) {
    throw new Error('USER_NOTIFICATION_INVALID');
  }
  return value as UserNotification;
};

const notificationsCollection = (recipientUserId: string) =>
  adminDb.collection(`users/${recipientUserId}/notifications`);

// Only person-origin events are protected; a commercial/store or system
// event is not reclassified merely because an identifier happens to match.
const isPersonal = (notification: UserNotification): boolean =>
  notification.category === 'user_forward' || notification.category === 'community_group_invite';
const isReservedNotification = (notification: UserNotification, peers: Set<string>): boolean =>
  isPersonal(notification) && peers.has(notification.actorPrincipalId);

async function projectInbox(input:{recipientUserId:string;limit?:number},scope:'ordinary'|'reserved',token?:unknown):Promise<UserNotificationInbox>{
  const recipientUserId=clean(input.recipientUserId);
  if(!recipientUserId)throw Error('USER_NOTIFICATION_USER_REQUIRED');
  const limit=Math.max(1,Math.min(100,Math.floor(input.limit??50)));
  if(!Number.isFinite(limit))throw Error('USER_NOTIFICATION_REQUIRED');
  if(scope==='reserved'&&typeof token!=='string')throw Error('USER_NOTIFICATION_NOT_FOUND');
  return adminDb.runTransaction(async transaction=>{
    const policy=await readReservedTribeNotificationScope(transaction,recipientUserId,scope==='reserved'?token:undefined);
    const visible=(notification:UserNotification)=>isReservedNotification(notification,policy.peers)===(scope==='reserved');
    const collection=notificationsCollection(recipientUserId);
    const ordered=collection.orderBy('createdAt','desc').orderBy(FieldPath.documentId(),'desc');
    const notifications:UserNotification[]=[];
    let cursor:FirebaseFirestore.QueryDocumentSnapshot|undefined;
    while(notifications.length<limit){
      const page=await transaction.get((cursor?ordered.startAfter(cursor):ordered).limit(100));
      for(const document of page.docs){
        const row=parseNotification(document,recipientUserId);
        if(visible(row))notifications.push(row);
        if(notifications.length===limit)break;
      }
      if(page.size<100)break;
      cursor=page.docs[page.size-1];
    }
    const unread=await transaction.get(collection.where('readAt','==',''));
    const unreadCount=unread.docs.filter(document=>visible(parseNotification(document,recipientUserId))).length;
    if(scope==='reserved')await readReservedTribeNotificationScope(transaction,recipientUserId,token);
    return {notifications,unreadCount,personalBrowserNotificationsAllowed:scope==='ordinary'&&!policy.protectedDirectory};
  });
}
export const listUserNotifications=(input:{recipientUserId:string;limit?:number}):Promise<UserNotificationInbox>=>
  projectInbox(input,'ordinary');
// No public route until the reserved interface and isolated authentication are ready.
export const listReservedUserNotifications=(input:{recipientUserId:string;limit?:number},token:unknown):Promise<UserNotificationInbox>=>
  projectInbox(input,'reserved',token);

export const markUserNotificationRead = async (input: {
  recipientUserId: string;
  notificationId: string;
  now?: Date;
}): Promise<void> => {
  const recipientUserId = clean(input.recipientUserId);
  const notificationId = clean(input.notificationId);
  if (!recipientUserId || !notificationId) {
    throw new Error('USER_NOTIFICATION_REQUIRED');
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('USER_NOTIFICATION_TIME_INVALID');
  const reference = adminDb.doc(
    userNotificationPath(recipientUserId, notificationId)
  );

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('USER_NOTIFICATION_NOT_FOUND');
    const notification = parseNotification(
      { id: snapshot.id, data: () => snapshot.data()! },
      recipientUserId
    );
    const policy=await readReservedTribeNotificationScope(transaction,recipientUserId);
    if(isReservedNotification(notification,policy.peers))throw Error('USER_NOTIFICATION_NOT_FOUND');
    if (notification.readAt) return;
    transaction.update(reference, { readAt: now.toISOString() });
  });
};

export const markAllUserNotificationsRead = async (input: {
  recipientUserId: string;
  now?: Date;
}): Promise<number> => {
  const recipientUserId = clean(input.recipientUserId);
  if (!recipientUserId) throw new Error('USER_NOTIFICATION_USER_REQUIRED');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('USER_NOTIFICATION_TIME_INVALID');
  return adminDb.runTransaction(async transaction=>{
    const policy=await readReservedTribeNotificationScope(transaction,recipientUserId);
    const ordered=notificationsCollection(recipientUserId).where('readAt','==','').orderBy(FieldPath.documentId());
    const visible:FirebaseFirestore.QueryDocumentSnapshot[]=[];
    let cursor:FirebaseFirestore.QueryDocumentSnapshot|undefined;
    while(visible.length<200){
      const page=await transaction.get((cursor?ordered.startAfter(cursor):ordered).limit(200));
      for(const document of page.docs){
        if(!isReservedNotification(parseNotification(document,recipientUserId),policy.peers))visible.push(document);
        if(visible.length===200)break;
      }
      if(page.size<200)break;
      cursor=page.docs[page.size-1];
    }
    const readAt=now.toISOString();
    for(const document of visible)transaction.update(document.ref,{readAt});
    return visible.length;
  });
};

export async function markReservedUserNotificationRead(input:{recipientUserId:string;notificationId:string},token:unknown){
 const recipientUserId=clean(input.recipientUserId),notificationId=clean(input.notificationId);
 if(typeof token!=='string'||!recipientUserId||!notificationId)throw Error('USER_NOTIFICATION_NOT_FOUND');
 return adminDb.runTransaction(async transaction=>{
  const reference=adminDb.doc(userNotificationPath(recipientUserId,notificationId));
  const snapshot=await transaction.get(reference);
  if(!snapshot.exists)throw Error('USER_NOTIFICATION_NOT_FOUND');
  const notification=parseNotification({id:snapshot.id,data:()=>snapshot.data()!},recipientUserId);
  const policy=await readReservedTribeNotificationScope(transaction,recipientUserId,token);
  if(!isReservedNotification(notification,policy.peers))throw Error('USER_NOTIFICATION_NOT_FOUND');
  if(!notification.readAt)transaction.update(reference,{readAt:new Date().toISOString()});
 });
}
