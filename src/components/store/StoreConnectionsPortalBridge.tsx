import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from 'firebase/auth';
import {
  KYRUB_ACTIVITY_UPDATED_EVENT,
} from '../../observability/kyrubActivityBrowser';
import { readRecentKyrubActivityEvents } from '../../observability/kyrubActivityLog';
import MercadoLivreE2ETestBridge from './MercadoLivreE2ETestBridge';
import NinetyNineFoodE2ETestBridge from './NinetyNineFoodE2ETestBridge';
import { PhysicalInventoryWorkspace } from './PhysicalInventoryWorkspace';
import StoreChannelCenter from './StoreChannelCenter';
import StoreChannelOperationsQueue from './StoreChannelOperationsQueue';
import StoreConnectionsWorkspace from './StoreConnectionsWorkspace';
import StoreInventoryAuthorityRepairPanel from './StoreInventoryAuthorityRepairPanel';
import StoreOwnerGovernancePanel from './StoreOwnerGovernancePanel';

interface StoreConnectionsPortalBridgeProps {
  user: User;
  storeId: string;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type ActivityUpdatedDetail = {
  actorUid?: string;
  eventId?: string;
};

export default function StoreConnectionsPortalBridge({
  user,
  storeId,
  notify,
}: StoreConnectionsPortalBridgeProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [inventoryRefreshVersion, setInventoryRefreshVersion] = useState(0);
  const [authorityRefreshVersion, setAuthorityRefreshVersion] = useState(0);
  const storeViewRefreshVersion = inventoryRefreshVersion + authorityRefreshVersion;

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;

    const mount = (): void => {
      if (cancelled) return;

      const productHost = document.getElementById('kyrub-product-inventory-workspace-host');
      if (!productHost?.parentElement) {
        timer = window.setTimeout(mount, 80);
        return;
      }

      const existing = document.getElementById('kyrub-store-connections-workspace-host');
      if (existing instanceof HTMLElement) {
        portalHost = existing as HTMLDivElement;
        setHost(existing);
        return;
      }

      portalHost = document.createElement('div');
      portalHost.id = 'kyrub-store-connections-workspace-host';
      portalHost.className = 'mb-5 min-w-0';
      productHost.parentElement.insertBefore(portalHost, productHost);
      setHost(portalHost);
    };

    timer = window.setTimeout(mount, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      portalHost?.remove();
      setHost(null);
    };
  }, [storeId, user.uid]);

  useEffect(() => {
    let cancelled = false;

    const handleActivityUpdated = (event: Event): void => {
      const detail = (event as CustomEvent<ActivityUpdatedDetail>).detail;
      const eventId = detail?.eventId?.trim() ?? '';
      if (
        !eventId ||
        detail?.actorUid?.trim() !== user.uid ||
        user.uid !== storeId
      ) {
        return;
      }

      window.setTimeout(() => {
        if (cancelled) return;
        try {
          const receiptEvent = readRecentKyrubActivityEvents(
            window.localStorage,
            user.uid,
            20
          ).find(candidate => candidate.id === eventId);

          if (
            receiptEvent?.type !== 'result.action_succeeded' ||
            receiptEvent.actionId !== 'adjust_inventory' ||
            receiptEvent.source !== 'authoritative_write_ack' ||
            receiptEvent.authority !== 'confirmed_result'
          ) {
            return;
          }

          setInventoryRefreshVersion(version => version + 1);
        } catch (error) {
          console.warn(
            'Não foi possível interpretar o recibo local para atualizar as visões de estoque.',
            error
          );
        }
      }, 0);
    };

    window.addEventListener(KYRUB_ACTIVITY_UPDATED_EVENT, handleActivityUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(KYRUB_ACTIVITY_UPDATED_EVENT, handleActivityUpdated);
    };
  }, [storeId, user.uid]);

  if (!host || user.uid !== storeId) return null;

  return createPortal(
    <div className="space-y-5">
      <StoreChannelCenter
        key={`channel-center-${storeViewRefreshVersion}`}
        user={user}
        storeId={storeId}
      />
      <StoreInventoryAuthorityRepairPanel
        key={`authority-repair-${storeViewRefreshVersion}`}
        user={user}
        storeId={storeId}
        onApplied={() => setAuthorityRefreshVersion(version => version + 1)}
      />
      <StoreOwnerGovernancePanel
        key={`owner-governance-${storeViewRefreshVersion}`}
        user={user}
        storeId={storeId}
        onApplied={() => setAuthorityRefreshVersion(version => version + 1)}
      />
      {inventoryRefreshVersion > 0 && (
        <div
          id="kyrub-post-inventory-adjustment-guidance"
          className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.055] px-4 py-3 text-[10px] leading-relaxed text-cyan-100"
          role="status"
        >
          <strong className="block text-cyan-200">Ajuste confirmado · visões reconsultadas</strong>
          <span className="mt-1 block">
            O Kyrub reconsultou o estoque físico e as pendências dos canais. Isso não significa que um bloqueio ATP foi resolvido: se o pedido 99Food continuar listado, ele permanece bloqueado e exige uma nova ação explícita em “Tentar reservar novamente”.
          </span>
        </div>
      )}
      <StoreChannelOperationsQueue
        key={`channel-operations-${storeViewRefreshVersion}`}
        user={user}
        storeId={storeId}
      />
      <PhysicalInventoryWorkspace
        key={`physical-inventory-${storeViewRefreshVersion}`}
        storeId={storeId}
      />
      <div id="kyrub-mercado-livre-channel-detail">
        <StoreConnectionsWorkspace user={user} storeId={storeId} notify={notify} />
      </div>
      <MercadoLivreE2ETestBridge user={user} storeId={storeId} notify={notify} />
      <div id="kyrub-99food-channel-detail">
        <NinetyNineFoodE2ETestBridge notify={notify} />
      </div>
    </div>,
    host
  );
}
