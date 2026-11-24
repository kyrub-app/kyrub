import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  setDoc,
  getDocFromServer,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from '../utils/firebase';
import {isConfirmedSocialSnapshot} from '../utils/socialSnapshotAuthority';

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
  const [messageScope,setMessageScope]=useState('');
  const uid = auth.currentUser?.uid;
  const scope = enabled && uid && connectionId && receiverId ? JSON.stringify([uid,connectionId,receiverId]) : '';
  const [history, setHistory] = useState<{scope:string; cutoff:Timestamp|null}>({scope:'',cutoff:null});
  const [historyError, setHistoryError] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const clearing = useRef(false);
  const [retry, setRetry] = useState(0);
  const historyReady = !!scope && history.scope === scope && !historyError;
  useEffect(() => {
    setHistory({scope:'',cutoff:null});
    setHistoryError('');
    if(!scope || !uid || !isValidId(connectionId)) return;
    return onSnapshot(doc(db,'social_chats',connectionId,'history_state',uid), {includeMetadataChanges:true}, snap => {
      if(!isConfirmedSocialSnapshot(snap.metadata,uid,auth.currentUser?.uid)){
        setHistory({scope:'',cutoff:null});return;
      }
      const cutoff=snap.get('clearedAt');
      setHistory({scope,cutoff:cutoff instanceof Timestamp ? cutoff : null});
      setHistoryError('');
    }, () => {setHistory({scope:'',cutoff:null});setHistoryError('Não foi possível consultar seu histórico privado.');});
  },[scope,uid,connectionId,retry]);
  const clearConversation = useCallback(async () => {
    if(!historyReady || !uid || auth.currentUser?.uid!==uid || !isValidId(connectionId) || clearing.current) return;
    clearing.current=true;setIsClearing(true);
    try {
      const marker=doc(db,'social_chats',connectionId,'history_state',uid);
      await setDoc(marker,{clearedAt:serverTimestamp()});
      const saved=await getDocFromServer(marker);
      const cutoff=saved.get('clearedAt');
      if(auth.currentUser?.uid===uid && cutoff instanceof Timestamp)
        setHistory(current=>current.scope===scope?{scope,cutoff}:current);
    } finally {clearing.current=false;setIsClearing(false);}
  },[historyReady,uid,connectionId,scope]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMessages([]);
    setMessageScope('');
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
      {includeMetadataChanges:true},
      snapshot => {
        if(!isConfirmedSocialSnapshot(snapshot.metadata,currentUser.uid,auth.currentUser?.uid)){
          setMessages([]);setMessageScope('');setIsLoading(true);return;
        }
        setMessageScope(scope);
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
        setMessages([]);setMessageScope('');
        setIsLoading(false);
        setError(getErrorMessage(listenerError));
      }
    );
  }, [connectionId, enabled, receiverId, uid, scope]);

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      const authError = new Error('É necessário estar autenticado para enviar mensagens.');
      setError(authError.message);
      throw authError;
    }

    if (!enabled || !historyReady || messageScope!==scope || !isValidId(connectionId) || !isValidId(receiverId)) {
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
  }, [connectionId, enabled, receiverId, historyReady, messageScope, scope]);

  return {
    messages: historyReady && messageScope===scope ? messages.filter(message => {
      const cutoff=history.cutoff;
      if(!cutoff) return true;
      const time=message.createdAt;
      return !!time && (time.seconds>cutoff.seconds || (time.seconds===cutoff.seconds && time.nanoseconds>cutoff.nanoseconds));
    }) : [],
    isLoading: isLoading || (!!scope && !historyReady && !historyError),
    isSending,
    isClearing,
    historyReady:historyReady&&messageScope===scope,
    historyError,
    retryHistory:()=>setRetry(value=>value+1),
    clearConversation,
    error,
    sendMessage
  };
}
