import type { GeoPoint, Timestamp } from 'firebase/firestore';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  wholesalePrice?: number;
  image: string;
  stock: number;
  supplierId?: string;
  isService?: boolean;
  category: string;
}

export interface Store {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo: string;
  banner: string;
  primaryColor: string;
  plan: 'free' | 'business';
  ownerEmail: string;
  address?: string;
  contact?: string;
  keywords?: string[];
  offerImages?: string[];
  lat?: number;
  lng?: number;
  isNew?: boolean;
  status?: 'open' | 'delayed' | 'closed';
}

export interface UserOwnedStore extends Store {
  ownerId: string;
}

export type UserStoreDocument = Omit<
  UserOwnedStore,
  'isNew' | 'keywords' | 'offerImages' | 'status'
> & {
  address: string;
  contact: string;
  keywords: string[];
  offerImages: string[];
  status: 'open' | 'delayed' | 'closed';
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type MarketplacePublicationStatus =
  | 'draft'
  | 'published'
  | 'paused';

export type MarketplaceListingType = 'store' | 'offer';

export interface MarketplaceListingBaseDocument {
  listingId: string;
  listingType: MarketplaceListingType;
  ownerId: string;
  storeId: string;
  publicationStatus: MarketplacePublicationStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  publishedAt?: Timestamp;
}

export interface MarketplaceStoreListingDocument
  extends MarketplaceListingBaseDocument {
  listingType: 'store';
  name: string;
  slug: string;
  description: string;
  address: string;
  logo: string;
  banner: string;
  primaryColor: string;
  keywords: string[];
  status: 'open' | 'delayed' | 'closed';
  geoPosition?: GeoPoint;
}

export interface MarketplaceOfferListingDocument
  extends MarketplaceListingBaseDocument {
  listingType: 'offer';
  offerId: string;
  name: string;
  description: string;
  price: number;
  imageUrls: string[];
  stock: number;
  isService: boolean;
  category: string;
}

export type MarketplaceListingDocument =
  | MarketplaceStoreListingDocument
  | MarketplaceOfferListingDocument;

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  wholesalePrice?: number;
}

export interface Order {
  id: string;
  storeId?: string;
  buyerName: string;
  buyerEmail: string;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered';
  createdAt: string;
  type: 'retail' | 'wholesale';
}

export interface Tenant {
  id: string;
  name: string;
  email: string;
  role: 'supplier' | 'retailer';
  storeId?: string;
  plan: 'free' | 'business';
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface NoteChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface NoteAuditLog {
  user: string;
  action: string;
  timestamp: string;
  userId?: string;
}

export interface NoteCollaborator {
  uid: string;
  name: string;
  email?: string;
  avatar?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  associatedUsers: string[];
  checklist: NoteChecklistItem[];
  auditLogs: NoteAuditLog[];
  shared?: boolean;
  mediaUrls?: string[];
  reminderDateTime?: string | null;
  isPublishedToFeed?: boolean;
  ownerId?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerAvatar?: string;
  collaborators?: NoteCollaborator[];
  sharedWith?: string[];
  acceptedWith?: string[];
  createdAt?: string;
  updatedAt?: string;
  syncState?: 'local' | 'pending' | 'synced' | 'error';
}

export type ConnectionStatus =
  | 'none'
  | 'pending_sent'
  | 'pending_received'
  | 'accepted';

export interface Friend {
  id: string;
  name: string;
  role: string;
  added: boolean;
  avatar: string;
  bio?: string;
  isProfileVisible?: boolean;
  favorited?: boolean;
  connectionStatus?: ConnectionStatus;
  connectionId?: string;
}

export interface SocialPost {
  id: string;
  user: string;
  avatar: string;
  time: string;
  content: string;
  likes: number;
  mediaUrls?: string[];
}

export interface DeliveryJob {
  id: string;
  from: string;
  to: string;
  distance: number;
  payment: number;
  status: 'available' | 'accepted' | 'delivering' | 'done';
  requestedBy?: string;
  acceptedBy?: string;
}

export interface FreelanceJob {
  id: string;
  title: string;
  employer: string;
  description: string;
  payment: number;
  distance: number;
  status: 'open' | 'applied' | 'hired' | 'done';
}
