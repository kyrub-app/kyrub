import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  LoaderCircle,
  Megaphone,
  RefreshCw,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  STORE_CAMPAIGN_MAX_BODY_LENGTH,
  STORE_CAMPAIGN_MAX_TITLE_LENGTH,
  STORE_CAMPAIGN_SEGMENTS,
  type StoreCampaignAudiencePreview,
  type StoreCampaignRecord,
  type StoreCampaignSegment,
} from '../../../shared/storeCampaigns';
import {
  listStoreCampaigns,
  previewStoreCampaign,
  sendStoreCampaign,
} from '../../utils/storeCampaigns';

const formatDate = (value: string): string => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const makeIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '_');
  }
  return `campaign_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export const StoreCampaignManager = ({ storeId }: { storeId: string }) => {
  const [segment, setSegment] = useState<StoreCampaignSegment>('all_customers');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<StoreCampaignAudiencePreview | null>(null);
  const [campaigns, setCampaigns] = useState<StoreCampaignRecord[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const selectedSegment = useMemo(
    () => STORE_CAMPAIGN_SEGMENTS.find(item => item.id === segment),
    [segment]
  );

  const refreshPreview = async (): Promise<void> => {
    setLoadingPreview(true);
    try {
      setPreview(await previewStoreCampaign({ storeId, segment }));
      setErrorMessage('');
    } catch (error) {
      setPreview(null);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível calcular a audiência.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const refreshHistory = async (): Promise<void> => {
    try {
      setCampaigns(await listStoreCampaigns(storeId));
    } catch (error) {
      console.warn('Store campaigns history unavailable.', error);
    }
  };

  useEffect(() => {
    void refreshPreview();
  }, [storeId, segment]);

  useEffect(() => {
    void refreshHistory();
  }, [storeId]);

  const send = async (): Promise<void> => {
    if (sending || !title.trim() || !body.trim()) return;
    setSending(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await sendStoreCampaign({
        storeId,
        segment,
        title: title.trim(),
        body: body.trim(),
        idempotencyKey: makeIdempotencyKey(),
      });
      setSuccessMessage(
        `${result.campaign.deliveredCount} entrega${result.campaign.deliveredCount === 1 ? '' : 's'} autorizada${result.campaign.deliveredCount === 1 ? '' : 's'} · ${result.campaign.skippedNoMarketingConsentCount} sem consentimento.`
      );
      setTitle('');
      setBody('');
      await Promise.all([refreshPreview(), refreshHistory()]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível enviar a campanha.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4" id="store-campaign-manager">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Megaphone className="mt-0.5 h-4 w-4 text-orange-400" />
          <div>
            <h4 className="text-[11px] font-black uppercase text-white">Campanhas do CRM</h4>
            <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
              A audiência é calculada pelo servidor a partir do relacionamento real. Marketing só é entregue a quem autorizou.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void Promise.all([refreshPreview(), refreshHistory()])} className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-500" aria-label="Atualizar campanhas">
          <RefreshCw className={`h-3.5 w-3.5 ${loadingPreview ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-[8px] font-mono uppercase text-slate-500">Segmento</span>
          <select value={segment} onChange={event => setSegment(event.target.value as StoreCampaignSegment)} className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-[10px] text-white outline-none">
            {STORE_CAMPAIGN_SEGMENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <span className="block text-[8px] leading-relaxed text-slate-600">{selectedSegment?.description}</span>
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5"><Users className="mb-1 h-3.5 w-3.5 text-slate-500" /><strong className="block text-sm text-white">{preview?.candidateCount ?? '—'}</strong><span className="text-[7px] uppercase text-slate-600">CRM</span></div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5"><CheckCircle2 className="mb-1 h-3.5 w-3.5 text-emerald-400" /><strong className="block text-sm text-emerald-300">{preview?.marketingEligibleCount ?? '—'}</strong><span className="text-[7px] uppercase text-slate-600">autorizados</span></div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5"><ShieldCheck className="mb-1 h-3.5 w-3.5 text-slate-500" /><strong className="block text-sm text-slate-300">{preview?.skippedNoMarketingConsentCount ?? '—'}</strong><span className="text-[7px] uppercase text-slate-600">sem opt-in</span></div>
        </div>
      </div>

      {preview && preview.sample.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {preview.sample.map(customer => (
            <span key={customer.customerId} className={`rounded-full border px-2 py-1 text-[7px] ${customer.marketingEligible ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-slate-800 bg-slate-950 text-slate-600'}`}>
              {customer.displayName} · {customer.levelLabel}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-2">
        <input value={title} maxLength={STORE_CAMPAIGN_MAX_TITLE_LENGTH} onChange={event => setTitle(event.target.value)} placeholder="Título da campanha" className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none" />
        <textarea value={body} maxLength={STORE_CAMPAIGN_MAX_BODY_LENGTH} onChange={event => setBody(event.target.value)} placeholder="Mensagem para o cliente" rows={3} className="resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none" />
      </div>

      {errorMessage && <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] text-red-300">{errorMessage}</div>}
      {successMessage && <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[9px] text-emerald-300">{successMessage}</div>}

      <button type="button" onClick={() => void send()} disabled={sending || !title.trim() || !body.trim() || (preview?.candidateCount ?? 0) === 0} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-[9px] font-black uppercase text-white disabled:bg-slate-800 disabled:text-slate-600">
        {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Enviar campanha
      </button>

      {campaigns.length > 0 && (
        <div className="border-t border-slate-800 pt-3">
          <span className="text-[8px] font-mono uppercase text-slate-600">Últimos envios</span>
          <div className="mt-2 space-y-1.5">
            {campaigns.slice(0, 5).map(campaign => (
              <div key={campaign.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-950 px-3 py-2">
                <div className="min-w-0"><strong className="block truncate text-[9px] text-slate-300">{campaign.title}</strong><span className="text-[7px] text-slate-600">{formatDate(campaign.sentAt)}</span></div>
                <span className="shrink-0 text-[8px] text-emerald-400">{campaign.deliveredCount}/{campaign.candidateCount} entregues</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
