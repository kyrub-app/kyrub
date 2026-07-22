import { useEffect, useRef } from 'react';
import { auth } from '../../utils/firebase';
import {
  subscribeToOperationalDualWrite,
  type OperationalMirrorKind,
} from '../../utils/operationalDualWrite';

interface OperationalDualWriteBridgeProps {
  legacyStoreId: string;
  notify: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

const permissionMessageKey = (storeId: string): string =>
  `kyrub_dual_write_permission_notice_${storeId}`;

const readyMessageKey = (storeId: string): string =>
  `kyrub_dual_write_ready_notice_${storeId}`;

export const OperationalDualWriteBridge = ({
  legacyStoreId,
  notify,
}: OperationalDualWriteBridgeProps) => {
  const mirroredKinds = useRef<Set<OperationalMirrorKind>>(new Set());

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !legacyStoreId || user.uid !== legacyStoreId) return;

    let cancelled = false;
    let unsubscribe = () => undefined;

    void subscribeToOperationalDualWrite(user, legacyStoreId, {
      onReady: store => {
        if (cancelled) return;
        const storageKey = readyMessageKey(store.id);
        if (localStorage.getItem(storageKey)) return;
        localStorage.setItem(storageKey, '1');
        notify(
          'Migração segura ativada: pedidos e pagamentos serão mantidos nos dois caminhos.',
          'success'
        );
      },
      onMirrored: kind => {
        mirroredKinds.current.add(kind);
      },
      onUnavailable: () => {
        console.info(
          'Dual-write operacional aguardando o registro da loja canônica.',
          { legacyStoreId }
        );
      },
      onError: error => {
        if (cancelled) return;
        console.warn('Falha no espelhamento operacional canônico.', error);

        const code = (error as Error & { code?: string }).code ?? '';
        const permissionDenied =
          code === 'permission-denied' ||
          error.message.toLocaleLowerCase('pt-BR').includes('permission');

        if (!permissionDenied) return;
        const storageKey = permissionMessageKey(legacyStoreId);
        if (localStorage.getItem(storageKey)) return;
        localStorage.setItem(storageKey, '1');
        notify(
          'O fluxo atual foi preservado, mas as regras multi-loja ainda precisam ser publicadas no Firebase.',
          'warning'
        );
      },
    })
      .then(stop => {
        if (cancelled) {
          stop();
          return;
        }
        unsubscribe = stop;
      })
      .catch(error => {
        if (cancelled) return;
        console.warn('Não foi possível iniciar a gravação dupla.', error);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [legacyStoreId, notify]);

  return null;
};
