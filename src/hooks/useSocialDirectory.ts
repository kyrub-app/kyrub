import React, { useState, useEffect } from 'react';
import { db, auth } from '../utils/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { Friend } from '../types';
import { friends as initialFriends, connectionRequests as initialConnectionRequests } from '../constants/initialMocks';

const STORAGE_KEYS = {
  FRIENDS: 'kyrub_friends',
  CONNECTION_REQUESTS: 'kyrub_connection_requests',
  FAVORITE_STORES: 'kyrub_favorite_stores'
};

interface UseSocialDirectoryOptions {
  profileName: string;
  profilePhotoUrl: string;
  profileAddress: string;
  accountTypeLojista: boolean;
  accountTypeEntregador: boolean;
  isLoggedIn: boolean;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export function useSocialDirectory({
  profileName,
  profilePhotoUrl,
  profileAddress,
  accountTypeLojista,
  accountTypeEntregador,
  triggerToast
}: UseSocialDirectoryOptions) {
  // Social states
  const [friends, setFriends] = useState<Friend[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.FRIENDS);
    return saved ? JSON.parse(saved) : initialFriends;
  });

  const [dbUsers, setDbUsers] = useState<any[]>([]);

  const [connectionRequests, setConnectionRequests] = useState<any[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CONNECTION_REQUESTS);
    return saved ? JSON.parse(saved) : initialConnectionRequests;
  });

  const [favoriteStoreIds, setFavoriteStoreIds] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.FAVORITE_STORES);
    return saved ? JSON.parse(saved) : ['s-1'];
  });

  // Sync to LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.FRIENDS, JSON.stringify(friends));
  }, [friends]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CONNECTION_REQUESTS, JSON.stringify(connectionRequests));
  }, [connectionRequests]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.FAVORITE_STORES, JSON.stringify(favoriteStoreIds));
  }, [favoriteStoreIds]);

  // Connect / Disconnect Friends
  const handleToggleFriend = async (friendId: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      triggerToast('Faça login para conectar com outros usuários!', 'error');
      return;
    }

    setFriends(prev => {
      const exists = prev.some(f => f.id === friendId);
      if (exists) {
        return prev.map(f => {
          if (f.id !== friendId) return f;
          const nowAdded = !f.added;
          triggerToast(nowAdded ? `${f.name} adicionado aos amigos!` : `${f.name} removido dos amigos.`, 'info');
          
          if (nowAdded) {
            // Write connection request to Firestore in real-time
            const requestPayload = {
              id: currentUser.uid,
              name: profileName || 'Você',
              role: accountTypeLojista ? 'Lojista' : accountTypeEntregador ? 'Entregador' : 'Cliente',
              avatar: profilePhotoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
              bio: profileAddress || 'Membro do Kyrub',
              isProfileVisible: true,
              updatedAt: new Date().toISOString()
            };
            setDoc(doc(db, `users/${friendId}/connection_requests`, currentUser.uid), requestPayload)
              .then(() => triggerToast('Solicitação enviada em tempo real!', 'success'))
              .catch(err => console.error("Error creating connection request doc:", err));
          } else {
            // Delete request if unconnecting
            deleteDoc(doc(db, `users/${friendId}/connection_requests`, currentUser.uid))
              .catch(err => console.error("Error deleting connection request:", err));
          }
          return { ...f, added: nowAdded };
        });
      } else {
        // Find in database users directory
        const dbUser = dbUsers.find(u => u.id === friendId);
        if (dbUser) {
          const newFriend: Friend = {
            id: dbUser.id,
            name: dbUser.name || dbUser.email,
            role: dbUser.role || (dbUser.accountTypes?.lojista ? 'Lojista' : dbUser.accountTypes?.entregador ? 'Entregador' : 'Cliente'),
            added: true,
            avatar: dbUser.photoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
            bio: dbUser.bio || dbUser.whatsapp || 'Membro do Kyrub',
            isProfileVisible: dbUser.isProfileVisible !== false,
            favorited: false
          };
          triggerToast(`${newFriend.name} adicionado aos amigos!`, 'info');

          // Send request in real-time
          const requestPayload = {
            id: currentUser.uid,
            name: profileName || 'Você',
            role: accountTypeLojista ? 'Lojista' : accountTypeEntregador ? 'Entregador' : 'Cliente',
            avatar: profilePhotoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
            bio: profileAddress || 'Membro do Kyrub',
            isProfileVisible: true,
            updatedAt: new Date().toISOString()
          };
          setDoc(doc(db, `users/${friendId}/connection_requests`, currentUser.uid), requestPayload)
            .then(() => triggerToast('Solicitação enviada em tempo real!', 'success'))
            .catch(err => console.error("Error creating connection request doc:", err));

          return [newFriend, ...prev];
        }
        return prev;
      }
    });
  };

  // Get Suggested Friends
  const getSuggestions = () => {
    const mergedMap = new Map<string, any>();
    
    friends.forEach(f => {
      mergedMap.set(f.id, f);
    });

    dbUsers
      .filter(u => u.id !== auth.currentUser?.uid) // exclude current user
      .forEach(u => {
        const existingFriend = friends.find(f => f.id === u.id);
        mergedMap.set(u.id, {
          id: u.id,
          name: u.name || u.email,
          role: u.role || (u.accountTypes?.lojista ? 'Lojista' : u.accountTypes?.entregador ? 'Entregador' : 'Cliente'),
          added: existingFriend ? existingFriend.added : false,
          avatar: u.photoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
          bio: u.bio || u.whatsapp || 'Membro do Kyrub',
          isProfileVisible: u.isProfileVisible !== false,
          favorited: existingFriend ? existingFriend.favorited : false
        });
      });

    return Array.from(mergedMap.values()).filter(f => !f.added && f.isProfileVisible !== false);
  };

  // Favorite Friend toggle
  const handleToggleFavoriteFriend = (friendId: string) => {
    setFriends(prev =>
      prev.map(f => {
        if (f.id !== friendId) return f;
        const nowFavorited = !(f as any).favorited;
        triggerToast(nowFavorited ? `${f.name} adicionado aos favoritos!` : `${f.name} removido dos favoritos.`, 'success');
        return { ...f, favorited: nowFavorited } as any;
      })
    );
  };

  // Favorite Store toggle
  const handleToggleFavoriteStore = (storeId: string) => {
    if (favoriteStoreIds.includes(storeId)) {
      setFavoriteStoreIds(prev => prev.filter(id => id !== storeId));
      triggerToast('Loja removida dos favoritos!', 'info');
    } else {
      setFavoriteStoreIds(prev => [...prev, storeId]);
      triggerToast('Loja favoritada!', 'success');
    }
  };

  // Accept Connection Request
  const handleAcceptRequest = async (req: any) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const exists = friends.some(f => f.name === req.name);
    if (exists) {
      setFriends(prev => prev.map(f => f.name === req.name ? { ...f, added: true } : f));
    } else {
      const newFriend: Friend = {
        id: req.id,
        name: req.name,
        role: req.role,
        added: true,
        avatar: req.avatar,
        bio: req.bio || 'Sem biografia cadastrada no perfil.',
        isProfileVisible: true,
        favorited: false
      } as any;
      setFriends(prev => [...prev, newFriend]);
    }

    // Clean up request document from Firestore
    try {
      await deleteDoc(doc(db, `users/${currentUser.uid}/connection_requests`, req.id));
      triggerToast(`Solicitação de ${req.name} aceita! Conexão estabelecida.`, 'success');
    } catch (err) {
      console.error("Error deleting connection request doc:", err);
    }

    setConnectionRequests(prev => prev.filter(r => r.id !== req.id));
  };

  // Decline Connection Request
  const handleDeclineRequest = async (reqId: string, reqName: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      await deleteDoc(doc(db, `users/${currentUser.uid}/connection_requests`, reqId));
      triggerToast(`Solicitação de ${reqName} recusada.`, 'info');
    } catch (err) {
      console.error("Error deleting connection request doc:", err);
    }

    setConnectionRequests(prev => prev.filter(r => r.id !== reqId));
  };

  return {
    friends,
    setFriends,
    dbUsers,
    setDbUsers,
    connectionRequests,
    setConnectionRequests,
    favoriteStoreIds,
    setFavoriteStoreIds,
    handleToggleFriend,
    getSuggestions,
    handleToggleFavoriteFriend,
    handleToggleFavoriteStore,
    handleAcceptRequest,
    handleDeclineRequest
  };
}
