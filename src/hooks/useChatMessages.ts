import { useCallback, useEffect, useState } from 'react';
import {
  Timestamp,
  addDoc,
  collection,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from '../utils/firebase';

interface SocialChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  createdAt: Timestamp | null;
}

interface UseChatMessagesOptions {
  connectionId?: string;
  receiverId?: string;
  enabled: boolean;
}

const isValidId = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= 128
  && /^[a-zA-Z0-9_-]+$/.test(value);

const getErrorMessage = (error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;

  if (code === 'permission-denied') {
    return 'Você não tem permissão para acessar esta conversa.';
  }

  return error instanceof Error
    ? error.message
    : 'Não foi possível acessar as mensagens.';
};

export function useChatMessages({
  connectionId,
  receiverId,
  enabled
}: UseChatMessagesOptions) {
  const [messages, setMessages] = useState<SocialChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMessages([]);
    setError(null);

    const currentUser = auth.currentUser;

    if (
      !enabled
      || !currentUser
      || !isValidId(connectionId)
      || !isValidId(receiverId)
    ) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const messagesQuery = query(
      collection(
        db,
        'social_chats',
        connectionId,
        'messages'
      ),
      orderBy('createdAt', 'asc'),
      limitToLast(100)
    );

    return onSnapshot(
      messagesQuery,
      snapshot => {
        setMessages(
          snapshot.docs.map(snapshotDoc => {
            const data = snapshotDoc.data({ serverTimestamps: 'estimate' });

            return {
              id: snapshotDoc.id,
              senderId: typeof data.senderId === 'string' ? data.senderId : '',
              receiverId: typeof data.receiverId === 'string' ? data.receiverId : '',
              text: typeof data.text === 'string' ? data.text : '',
              createdAt:
                data.createdAt instanceof Timestamp ? data.createdAt : null
            };
          })
        );
        setIsLoading(false);
        setError(null);
      },
      listenerError => {
        setIsLoading(false);
        setError(getErrorMessage(listenerError));
      }
    );
  }, [connectionId, enabled, receiverId]);

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      const authError = new Error('É necessário estar autenticado para enviar mensagens.');
      setError(authError.message);
      throw authError;
    }

    if (!enabled || !isValidId(connectionId) || !isValidId(receiverId)) {
      const conversationError = new Error('Conversa inválida ou indisponível.');
      setError(conversationError.message);
      throw conversationError;
    }

    const normalizedText = text.trim();

    if (normalizedText.length === 0) {
      const emptyTextError = new Error('A mensagem não pode estar vazia.');
      setError(emptyTextError.message);
      throw emptyTextError;
    }

    if (normalizedText.length > 4000) {
      const lengthError = new Error('A mensagem deve ter no máximo 4000 caracteres.');
      setError(lengthError.message);
      throw lengthError;
    }

    setIsSending(true);
    setError(null);

    try {
      await addDoc(
        collection(
          db,
          'social_chats',
          connectionId,
          'messages'
        ),
        {
          senderId: currentUser.uid,
          receiverId,
          text: normalizedText,
          createdAt: serverTimestamp()
        }
      );
    } catch (sendError) {
      setError(getErrorMessage(sendError));
      throw sendError;
    } finally {
      setIsSending(false);
    }
  }, [connectionId, enabled, receiverId]);

  return {
    messages,
    isLoading,
    isSending,
    error,
    sendMessage
  };
}
