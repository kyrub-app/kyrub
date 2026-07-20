import type { Timestamp } from 'firebase/firestore';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number; // Retail price set by retailer
  wholesalePrice?: number; // Wholesale price set by supplier
  image: string;
  stock: number;
  supplierId?: string; // If imported from a supplier
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

export interface Note {
  id: string;
  title: string;
  content: string;
  associatedUsers: string[];
  checklist: { id: string; text: string; done: boolean }[];
  auditLogs: { user: string; action: string; timestamp: string }[];
  shared?: boolean;
  mediaUrls?: string[];
  reminderDateTime?: string | null;
  isPublishedToFeed?: boolean;
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
