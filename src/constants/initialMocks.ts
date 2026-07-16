import { Tenant, Store, Product, Order, Friend, SocialPost, DeliveryJob, FreelanceJob, Note } from '../types';
import { initialTenants, initialStores, initialProducts, initialOrders } from '../mockData';

export { initialTenants, initialStores, initialProducts, initialOrders };

export const appUsers = [];

export const friends: Friend[] = [];

export const posts: SocialPost[] = [];

export const deliveries: DeliveryJob[] = [];

export const freelanceJobs: FreelanceJob[] = [];

export const momentos: any[] = [];

export const connectionRequests = [];
// Mantemos o chat vazio para novos usuários
export const simulatedChatHistory: Record<string, { sender: string; text: string; time: string }[]> = {};
export const initialNotes: Note[] = [];
