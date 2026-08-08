import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, updateProfile, type User } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../utils/firebase';

type ProfileIdentity = {
  name: string;
  photoUrl: string;
};

const BACKUP_PREFIX = 'kyrub_profile_identity_v1';

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const backupKey = (uid: string): string => `${BACKUP_PREFIX}:${uid}`;

const readBackup = (uid: string): ProfileIdentity | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(backupKey(uid)) ?? 'null') as
      | Record<string, unknown>
      | null;
    if (!parsed) return null;
    const name = readString(parsed.name);
    const photoUrl = readString(parsed.photoUrl);
    return name || photoUrl ? { name, photoUrl } : null;
  } catch {
    return null;
  }
};

const saveBackup = (uid: string, identity: ProfileIdentity): void => {
  try {
    localStorage.setItem(backupKey(uid), JSON.stringify(identity));
  } catch {
    // A identidade continua disponível em memória quando o armazenamento local falha.
  }
};

const fallbackName = (user: User): string =>
  user.displayName?.trim() || user.email?.split('@')[0]?.trim() || 'Usuário Kyrub';

const syncLegacyHeader = (identity: ProfileIdentity): void => {
  const trigger = document.getElementById('header-user-profile-trigger');
  if (!trigger) return;

  const firstName = identity.name.split(/\s+/)[0]?.trim();
  const name = trigger.querySelector<HTMLElement>('h1 span');
  if (name && firstName && name.textContent !== firstName) {
    name.textContent = firstName;
  }

  const image = trigger.querySelector<HTMLImageElement>('img');
  if (image && identity.photoUrl && image.src !== identity.photoUrl) {
    image.src = identity.photoUrl;
  }
};

export function ProfileIdentityRecoveryBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const syncingUserDocumentRef = useRef(false);
  const syncingAuthRef = useRef(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) return;

    let userIdentity: ProfileIdentity = { name: '', photoUrl: '' };
    let publicIdentity: ProfileIdentity = { name: '', photoUrl: '' };
    const localBackup = readBackup(user.uid);
    let currentIdentity: ProfileIdentity = {
      name: localBackup?.name || fallbackName(user),
      photoUrl: localBackup?.photoUrl || user.photoURL || '',
    };

    const applyIdentity = () => {
      const preferred: ProfileIdentity = {
        name:
          publicIdentity.name ||
          userIdentity.name ||
          localBackup?.name ||
          fallbackName(user),
        photoUrl:
          publicIdentity.photoUrl ||
          userIdentity.photoUrl ||
          localBackup?.photoUrl ||
          user.photoURL ||
          '',
      };

      currentIdentity = preferred;
      saveBackup(user.uid, preferred);
      syncLegacyHeader(preferred);

      const serverBackedName = publicIdentity.name || userIdentity.name;
      const serverBackedPhoto = publicIdentity.photoUrl || userIdentity.photoUrl;
      if (
        !syncingAuthRef.current &&
        (serverBackedName || serverBackedPhoto) &&
        (user.displayName !== (serverBackedName || user.displayName) ||
          (serverBackedPhoto && user.photoURL !== serverBackedPhoto))
      ) {
        syncingAuthRef.current = true;
        void updateProfile(user, {
          displayName: serverBackedName || user.displayName,
          photoURL: serverBackedPhoto || user.photoURL,
        }).catch(error => {
          console.warn('Não foi possível alinhar a identidade do Firebase Auth.', error);
        }).finally(() => {
          syncingAuthRef.current = false;
        });
      }

      // O perfil público é a cópia editável pelo usuário. Se a inicialização
      // legada reaplicar um nome/foto diferente em /users/{uid}, restauramos
      // apenas esses campos públicos; nenhum dado privado é copiado ou apagado.
      if (
        !syncingUserDocumentRef.current &&
        publicIdentity.name &&
        (userIdentity.name !== publicIdentity.name ||
          (publicIdentity.photoUrl && userIdentity.photoUrl !== publicIdentity.photoUrl))
      ) {
        syncingUserDocumentRef.current = true;
        void setDoc(
          doc(db, 'users', user.uid),
          {
            uid: user.uid,
            name: publicIdentity.name,
            ...(publicIdentity.photoUrl
              ? { photoUrl: publicIdentity.photoUrl }
              : {}),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(error => {
          console.warn('Não foi possível restaurar a identidade pública do perfil.', error);
        }).finally(() => {
          syncingUserDocumentRef.current = false;
        });
      }
    };

    syncLegacyHeader(currentIdentity);

    const unsubscribeUser = onSnapshot(
      doc(db, 'users', user.uid),
      snapshot => {
        const data = snapshot.data() as Record<string, unknown> | undefined;
        userIdentity = {
          name: readString(data?.name),
          photoUrl: readString(data?.photoUrl),
        };
        applyIdentity();
      },
      error => {
        console.warn('O perfil principal está temporariamente indisponível.', error);
        syncLegacyHeader(currentIdentity);
      }
    );

    const unsubscribePublicProfile = onSnapshot(
      doc(db, `users/${user.uid}/public_profile/main`),
      snapshot => {
        const data = snapshot.data() as Record<string, unknown> | undefined;
        publicIdentity = {
          name: readString(data?.name),
          photoUrl: readString(data?.photoUrl),
        };
        applyIdentity();
      },
      error => {
        console.warn('O perfil público está temporariamente indisponível.', error);
        syncLegacyHeader(currentIdentity);
      }
    );

    const interval = window.setInterval(() => {
      syncLegacyHeader(currentIdentity);
    }, 750);

    return () => {
      window.clearInterval(interval);
      unsubscribeUser();
      unsubscribePublicProfile();
    };
  }, [user?.uid]);

  return null;
}
