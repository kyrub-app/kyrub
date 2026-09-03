import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  BadgeCheck,
  CircleAlert,
  CircleDot,
  Network,
  RefreshCw,
  Store,
} from 'lucide-react';
import type {
  KyrubCommerceChannel,
  KyrubConnectionStatus,
} from '../../../shared/storeConnections';
import {
  loadStoreConnectionOnboarding,
  type PublicStoreConnectionRecord,
  type StoreConnectionOnboardingSnapshot,
} from '../../utils/storeConnections';

type CenterChannel = 'kyrub_marketplace' | KyrubCommerceChannel;
type ChannelState = 'native' | 'connected' | 'connecting' | 'attention' | 'declared' | 'available';

type ChannelRow = {
  channel: CenterChannel;
  label: string;
  detail: string;
  state: ChannelState;
  connection: PublicStoreConnectionRecord | null;
};

const CHANNEL_ORDER: KyrubCommerceChannel[] = [
  'mercado_livre',
  '99food',
  'shopee',
  'ifood',
  'instagram',
  'erp',
  'other',
];

const AVAILABLE_INTEGRATIONS = new Set<KyrubCommerceChannel>([
  'mercado_livre',
  '99food',
]);

const channelLabel = (channel: CenterChannel): string => {
  switch (channel) {
    case 'kyrub_marketplace': return 'Kyrub Marketplace';
    case 'mercado_livre': return 'Mercado Livre';
    case '99food': return '99Food';
    case 'shopee': return 'Shopee';
    case 'ifood': return 'iFood';
    case 'instagram': return 'Instagram';
    case 'erp': return 'ERP';
    case 'other': return 'Outro canal';
  }
};

const stateFromConnection = (status: KyrubConnectionStatus): ChannelState => {
  if (status === 'connected') return 'connected';
  if (status === 'connecting') return 'connecting';
  return 'attention';
};

const statusPresentation = (state: ChannelState): {
  label: string;
  className: string;
  icon: typeof BadgeCheck;
} => {
  switch (state) {
    case 'native':
      return {
        label: 'Nativo · ativo',
        className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
        icon: BadgeCheck,
      };
    case 'connected':
      return {
        label: 'Conectado',
        className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
        icon: BadgeCheck,
      };
    case 'connecting':
      return {
        label: 'Conectando',
        className: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300',
        icon: CircleDot,
      };
    case 'attention':
      return {
        label: 'Requer atenção',
        className: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
        icon: CircleAlert,
      };
    case 'declared':
      return {
        label: 'Declarado',
        className: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
        icon: CircleDot,
      };
    default:
      return {
        label: 'Pode conectar',
        className: 'border-slate-700 bg-slate-900 text-slate-400',
        icon: Network,
      };
  }
};

const channelDetail = (row: Omit<ChannelRow, 'detail'>): string => {
  if (row.channel === 'kyrub_marketplace') {
    return 'Canal nativo da sua loja. Não depende de conta, token ou credencial externa.';
  }
  if (row.connection?.status === 'connected') {
    return `Conexão autoritativa ativa · sincronização: ${row.connection.syncAuthority}.`;
  }
  if (row.connection) {
    return `Existe um registro de conexão com status ${row.connection.status}. Revise o adapter antes de usar o canal.`;
  }
  if (row.state === 'declared' && AVAILABLE_INTEGRATIONS.has(row.channel)) {
    return 'Você declarou que já vende neste canal. A conta externa ainda não está conectada ao Kyrub.';
  }
  if (row.state === 'declared') {
    return 'Canal informado pela loja. A integração operacional ainda não está habilitada no Kyrub.';
  }
  return 'Integração disponível, mas esta loja ainda não declarou nem conectou o canal.';
};

const buildRows = (snapshot: StoreConnectionOnboardingSnapshot | null): ChannelRow[] => {
  const declared = new Set(snapshot?.declaration?.channels ?? []);
  const connectionsByChannel = new Map<KyrubCommerceChannel, PublicStoreConnectionRecord>();
  for (const connection of snapshot?.connections ?? []) {
    const current = connectionsByChannel.get(connection.channel);
    if (!current || current.status !== 'connected') {
      connectionsByChannel.set(connection.channel, connection);
    }
  }

  const externalChannels = CHANNEL_ORDER.filter(channel =>
    AVAILABLE_INTEGRATIONS.has(channel) || declared.has(channel) || connectionsByChannel.has(channel)
  );

  const rows: ChannelRow[] = [{
    channel: 'kyrub_marketplace',
    label: channelLabel('kyrub_marketplace'),
    detail: '',
    state: 'native',
    connection: null,
  }];

  for (const channel of externalChannels) {
    const connection = connectionsByChannel.get(channel) ?? null;
    const state: ChannelState = connection
      ? stateFromConnection(connection.status)
      : declared.has(channel)
        ? 'declared'
        : 'available';
    rows.push({
      channel,
      label: channelLabel(channel),
      detail: '',
      state,
      connection,
    });
  }

  return rows.map(row => ({ ...row, detail: channelDetail(row) }));
};

const scrollToChannel = (channel: CenterChannel): void => {
  if (channel === 'mercado_livre') {
    document.getElementById('kyrub-mercado-livre-channel-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (channel === '99food') {
    document.querySelector<HTMLElement>('[data-integration-id="99food"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

export default function StoreChannelCenter({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  const [snapshot, setSnapshot] = useState<StoreConnectionOnboardingSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const rows = useMemo(() => buildRows(snapshot), [snapshot]);
  const connectedCount = rows.filter(row => row.state === 'connected').length;
  const declaredCount = rows.filter(row => row.state === 'declared').length;
  const attentionCount = rows.filter(row => row.state === 'attention').length;

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setMessage('');
    try {
      setSnapshot(await loadStoreConnectionOnboarding(user, storeId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível consultar a Central de Canais.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [storeId, user.uid]);

  return (
    <section className="rounded-3xl border border-cyan-500/20 bg-cyan-500/[0.04] p-5" aria-label="Central de Canais">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">Omnichannel</span>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-black text-white">
            <Network className="h-5 w-5" /> Central de Canais
          </h3>
          <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-400">
            Uma visão única dos canais da sua loja. Declaração, conexão e autoridade de sincronização são estados diferentes; esta central não transforma um deles no outro.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
          <span className="block text-[9px] font-black uppercase text-slate-500">Conectados</span>
          <strong className="mt-1 block text-lg text-emerald-300">{connectedCount}</strong>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
          <span className="block text-[9px] font-black uppercase text-slate-500">Declarados</span>
          <strong className="mt-1 block text-lg text-violet-300">{declaredCount}</strong>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
          <span className="block text-[9px] font-black uppercase text-slate-500">Atenção</span>
          <strong className="mt-1 block text-lg text-amber-300">{attentionCount}</strong>
        </div>
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {rows.map(row => {
          const meta = statusPresentation(row.state);
          const StatusIcon = meta.icon;
          const canNavigate = row.channel === 'mercado_livre' || row.channel === '99food';
          return (
            <article key={row.channel} className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {row.channel === 'kyrub_marketplace' ? <Store className="h-4 w-4 text-emerald-300" /> : <Network className="h-4 w-4 text-slate-500" />}
                    <strong className="truncate text-sm text-white">{row.label}</strong>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{row.detail}</p>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${meta.className}`}>
                  <StatusIcon className="h-3 w-3" />
                  {meta.label}
                </span>
              </div>
              {canNavigate && row.channel !== 'kyrub_marketplace' && (
                <button
                  type="button"
                  onClick={() => scrollToChannel(row.channel)}
                  className="mt-3 text-[10px] font-black uppercase tracking-wider text-cyan-300 hover:text-cyan-200"
                >
                  Ver configuração do canal
                </button>
              )}
            </article>
          );
        })}
      </div>

      {message && (
        <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[10px] text-red-200" aria-live="polite">
          {message}
        </p>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-slate-600">
        A Central é uma projeção de leitura do registry autoritativo. Ela não conecta contas, não importa produtos, não altera estoque e não executa sincronização por conta própria.
      </p>
    </section>
  );
}
