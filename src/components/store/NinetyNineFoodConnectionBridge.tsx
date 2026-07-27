import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeCheck,
  CircleAlert,
  KeyRound,
  Link2,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import {
  connectNinetyNineFood,
  disconnectNinetyNineFood,
  getNinetyNineFoodConnectionStatus,
  pollNinetyNineFood,
  type NinetyNineFoodConnectionStatus,
} from '../../utils/ninetyNineFoodIntegration';

const emptyStatus: NinetyNineFoodConnectionStatus = {
  configured: false,
  provider: '99food',
  status: 'not-configured',
  externalStoreId: '',
  accountLabel: '',
  routingTarget: '',
  environment: 'sandbox',
  baseUrl: '',
  webhookUrl: '',
  lastError: '',
  lastVerifiedAt: '',
  lastWebhookAt: '',
  lastPollAt: '',
};

const formatTimestamp = (value: string): string => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString('pt-BR')
    : 'Ainda não registrado';
};

export function NinetyNineFoodConnectionBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState(emptyStatus);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [externalStoreId, setExternalStoreId] = useState('');
  const [accountLabel, setAccountLabel] = useState('');
  const [routingTarget, setRoutingTarget] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [baseUrl, setBaseUrl] = useState('');
  const [tokenUrl, setTokenUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  useEffect(() => {
    let portalHost: HTMLDivElement | null = null;
    let observedWarning: HTMLParagraphElement | null = null;
    let originalWarning = '';

    const synchronize = (): void => {
      const article = document.querySelector<HTMLElement>(
        '[data-integration-id="99food"]'
      );
      const configured = article && !article.querySelector(
        '#configure-store-integration-99food'
      );

      if (article && configured) {
        if (!portalHost || !portalHost.isConnected) {
          portalHost = document.createElement('div');
          portalHost.id = 'kyrub-99food-secure-connection-host';
          portalHost.className = 'mt-3';
          article.appendChild(portalHost);
          setHost(portalHost);
        }

        const warning = Array.from(
          document.querySelectorAll<HTMLParagraphElement>(
            '#store-integrations-tab-content p'
          )
        ).find(paragraph => paragraph.textContent?.includes(
          'Senhas, tokens, certificados e chaves privadas'
        ));
        if (warning && warning !== observedWarning) {
          if (observedWarning) observedWarning.textContent = originalWarning;
          observedWarning = warning;
          originalWarning = warning.textContent ?? '';
          warning.textContent =
            'Dados públicos ficam nos campos de configuração. O clientSecret da 99Food deve ser informado somente na caixa segura abaixo: ele é enviado diretamente ao backend, criptografado e nunca salvo no navegador.';
        }
      } else if (portalHost) {
        portalHost.remove();
        portalHost = null;
        setHost(null);
      }
    };

    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });
    synchronize();

    return () => {
      observer.disconnect();
      portalHost?.remove();
      if (observedWarning) observedWarning.textContent = originalWarning;
      setHost(null);
    };
  }, []);

  const refreshStatus = async (): Promise<void> => {
    try {
      const nextStatus = await getNinetyNineFoodConnectionStatus();
      setStatus(nextStatus);
      if (nextStatus.configured) {
        setExternalStoreId(nextStatus.externalStoreId);
        setAccountLabel(nextStatus.accountLabel);
        setRoutingTarget(nextStatus.routingTarget);
        setEnvironment(nextStatus.environment);
        setBaseUrl(nextStatus.baseUrl);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!host) return;
    void refreshStatus();
  }, [host]);

  const importPublicFields = (): void => {
    const article = document.querySelector<HTMLElement>(
      '[data-integration-id="99food"]'
    );
    const inputs = Array.from(
      article?.querySelectorAll<HTMLInputElement>('input[type="text"]') ?? []
    );
    const select = article?.querySelector<HTMLSelectElement>('select');
    setAccountLabel(inputs[0]?.value.trim() ?? accountLabel);
    setExternalStoreId(inputs[1]?.value.trim() ?? externalStoreId);
    setRoutingTarget(inputs[2]?.value.trim() ?? routingTarget);
    setEnvironment(select?.value === 'production' ? 'production' : 'sandbox');
    setFeedback('Dados públicos copiados. Informe agora as credenciais emitidas pela 99Food.');
  };

  const handleConnect = async (): Promise<void> => {
    setLoading(true);
    setFeedback('');
    try {
      const nextStatus = await connectNinetyNineFood({
        externalStoreId,
        accountLabel,
        routingTarget,
        environment,
        baseUrl,
        tokenUrl: tokenUrl || undefined,
        clientId,
        clientSecret,
      });
      setStatus(nextStatus);
      setClientId('');
      setClientSecret('');
      setFeedback(
        nextStatus.status === 'connected'
          ? 'Credenciais validadas e webhook registrado na 99Food.'
          : 'Credenciais validadas, mas o registro automático do webhook requer atenção.'
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handlePoll = async (): Promise<void> => {
    setLoading(true);
    setFeedback('');
    try {
      const result = await pollNinetyNineFood();
      await refreshStatus();
      setFeedback(
        result.received === 0
          ? 'Reconciliação concluída. Nenhum evento novo encontrado.'
          : `${result.processed} evento(s) processado(s) e confirmado(s).`
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setLoading(true);
    setFeedback('');
    try {
      await disconnectNinetyNineFood();
      setStatus(emptyStatus);
      setClientId('');
      setClientSecret('');
      setFeedback('Conexão removida do cofre do Kyrub.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const statusMeta = useMemo(() => {
    if (status.status === 'connected') {
      return {
        label: 'Conector ativo',
        className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
        icon: BadgeCheck,
      };
    }
    if (status.status === 'attention') {
      return {
        label: 'Requer atenção',
        className: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
        icon: CircleAlert,
      };
    }
    return {
      label: 'Credenciais não configuradas',
      className: 'border-slate-700 bg-slate-900 text-slate-400',
      icon: KeyRound,
    };
  }, [status.status]);

  if (!host) return null;
  const StatusIcon = statusMeta.icon;

  return createPortal(
    <section className="space-y-3 rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-yellow-500/20 bg-yellow-500/10">
            <ShieldCheck className="h-4 w-4 text-yellow-300" />
          </span>
          <div>
            <strong className="block text-[9px] font-black uppercase tracking-wide text-yellow-200">
              Conexão real 99Food · Open Delivery
            </strong>
            <p className="mt-1 text-[8px] leading-relaxed text-slate-400">
              As credenciais seguem por HTTPS diretamente ao servidor. O clientSecret é criptografado com AES-256-GCM e não volta para esta tela.
            </p>
          </div>
        </div>
        <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[7px] font-black uppercase ${statusMeta.className}`}>
          <StatusIcon className="h-3 w-3" />
          {statusMeta.label}
        </span>
      </div>

      <button
        type="button"
        onClick={importPublicFields}
        disabled={loading}
        className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40"
      >
        <Link2 className="h-3.5 w-3.5" />
        Usar dados preenchidos acima
      </button>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[8px] font-black uppercase text-slate-500">
          Merchant ID da 99Food
          <input
            value={externalStoreId}
            onChange={event => setExternalStoreId(event.target.value)}
            disabled={loading}
            autoComplete="off"
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-yellow-500 disabled:opacity-45"
          />
        </label>
        <label className="text-[8px] font-black uppercase text-slate-500">
          Nome da unidade
          <input
            value={accountLabel}
            onChange={event => setAccountLabel(event.target.value)}
            disabled={loading}
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-yellow-500 disabled:opacity-45"
          />
        </label>
        <label className="text-[8px] font-black uppercase text-slate-500">
          Destino no Kyrub
          <input
            value={routingTarget}
            onChange={event => setRoutingTarget(event.target.value)}
            disabled={loading}
            placeholder="COZINHA, EXPEDIÇÃO..."
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-yellow-500 disabled:opacity-45"
          />
        </label>
        <label className="text-[8px] font-black uppercase text-slate-500">
          Ambiente
          <select
            value={environment}
            onChange={event => setEnvironment(
              event.target.value === 'production' ? 'production' : 'sandbox'
            )}
            disabled={loading}
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] text-white outline-none focus:border-yellow-500 disabled:opacity-45"
          >
            <option value="sandbox">Sandbox / homologação</option>
            <option value="production">Produção</option>
          </select>
        </label>
      </div>

      <label className="block text-[8px] font-black uppercase text-slate-500">
        URL base da API informada pela 99Food
        <input
          type="url"
          value={baseUrl}
          onChange={event => setBaseUrl(event.target.value)}
          disabled={loading}
          placeholder="https://api-sandbox.exemplo.99app.com"
          autoComplete="off"
          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-yellow-500 disabled:opacity-45"
        />
      </label>

      <label className="block text-[8px] font-black uppercase text-slate-500">
        URL do token, somente se for diferente
        <input
          type="url"
          value={tokenUrl}
          onChange={event => setTokenUrl(event.target.value)}
          disabled={loading}
          placeholder="Opcional: .../oauth/token"
          autoComplete="off"
          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-yellow-500 disabled:opacity-45"
        />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[8px] font-black uppercase text-slate-500">
          Client ID
          <input
            type="password"
            value={clientId}
            onChange={event => setClientId(event.target.value)}
            disabled={loading}
            autoComplete="off"
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-yellow-500 disabled:opacity-45"
          />
        </label>
        <label className="text-[8px] font-black uppercase text-slate-500">
          Client Secret
          <input
            type="password"
            value={clientSecret}
            onChange={event => setClientSecret(event.target.value)}
            disabled={loading}
            autoComplete="new-password"
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-yellow-500 disabled:opacity-45"
          />
        </label>
      </div>

      {status.configured && (
        <div className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[8px] text-slate-400 sm:grid-cols-2">
          <span>Última verificação: <strong className="text-slate-200">{formatTimestamp(status.lastVerifiedAt)}</strong></span>
          <span>Último webhook: <strong className="text-slate-200">{formatTimestamp(status.lastWebhookAt)}</strong></span>
          <span>Último polling: <strong className="text-slate-200">{formatTimestamp(status.lastPollAt)}</strong></span>
          <span className="break-all">Webhook: <strong className="text-slate-200">{status.webhookUrl || 'Ainda não registrado'}</strong></span>
        </div>
      )}

      {(feedback || status.lastError) && (
        <div className={`rounded-xl border px-3 py-2.5 text-[8px] leading-relaxed ${
          status.lastError
            ? 'border-amber-500/20 bg-amber-500/5 text-amber-200'
            : 'border-cyan-500/20 bg-cyan-500/5 text-cyan-200'
        }`}>
          {feedback || status.lastError}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void handleConnect()}
          disabled={loading}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-yellow-400 px-3 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40"
          id="connect-real-99food-button"
        >
          <KeyRound className="h-3.5 w-3.5" />
          {loading ? 'Processando...' : status.configured ? 'Atualizar credenciais' : 'Validar e conectar'}
        </button>
        <button
          type="button"
          onClick={() => void handlePoll()}
          disabled={loading || !status.configured}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 text-[8px] font-black uppercase text-cyan-300 disabled:opacity-40"
          id="poll-99food-button"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reconciliar pedidos agora
        </button>
      </div>

      {status.configured && (
        <button
          type="button"
          onClick={() => void handleDisconnect()}
          disabled={loading}
          className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/5 px-3 text-[8px] font-black uppercase text-red-300 disabled:opacity-40"
        >
          <Unplug className="h-3.5 w-3.5" />
          Remover credenciais do Kyrub
        </button>
      )}
    </section>,
    host
  );
}
