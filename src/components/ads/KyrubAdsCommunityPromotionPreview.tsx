import { useState } from 'react';
import { ArrowUpRight, Megaphone, X } from 'lucide-react';
import type { CloudCommunityPost } from '../../utils/communityCloud';

export const KYRUB_ADS_DURATIONS = [7, 15, 21, 30] as const;
type CampaignDuration = (typeof KYRUB_ADS_DURATIONS)[number];

interface KyrubAdsCommunityPromotionPreviewProps {
  post: CloudCommunityPost;
  onClose: () => void;
}

/**
 * Entry point into the future Kyrub Ads campaign editor.
 * This UI is deliberately a preview: it never creates a campaign, persists a
 * draft, offers checkout, starts distribution or promises a paid placement.
 */
export function KyrubAdsCommunityPromotionPreview({
  post, onClose,
}: KyrubAdsCommunityPromotionPreviewProps) {
  const [duration, setDuration] = useState<CampaignDuration>(7);

  return (
    <div
      className="fixed inset-0 z-[210] flex items-end justify-center bg-slate-950/90 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Prévia de promoção no Kyrub Ads"
    >
      <section className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-700 bg-slate-950 shadow-2xl sm:rounded-3xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-2 text-sky-300">
              <Megaphone className="h-5 w-5"/>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">Kyrub Ads</p>
              <h2 className="text-base font-bold text-white">Promover publicação</h2>
            </div>
          </div>
          <button type="button" aria-label="Fechar prévia de promoção" onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 text-slate-300">
            <X className="h-5 w-5"/>
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto p-4">
          <p className="text-sm leading-relaxed text-slate-300">
            Sua publicação da comunidade poderá alcançar mais pessoas por meio de
            uma campanha identificada como patrocinada, após aprovação.
          </p>
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-3">
            <span className="inline-flex rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[11px] font-bold text-sky-300">
              Patrocinado · Prévia
            </span>
            <p className="mt-2 text-xs font-semibold text-slate-100">{post.authorName}</p>
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-sm text-slate-300">
              {post.content || 'Publicação com mídia da comunidade'}
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-white">Duração da campanha (prévia)</legend>
            <div className="grid grid-cols-4 gap-2">
              {KYRUB_ADS_DURATIONS.map(days => (
                <button
                  type="button"
                  key={days}
                  aria-pressed={duration === days}
                  onClick={() => setDuration(days)}
                  className={`min-h-11 rounded-xl border px-1 text-xs font-bold ${duration === days
                    ? 'border-sky-400 bg-sky-500/15 text-sky-100'
                    : 'border-slate-700 bg-slate-900 text-slate-300'}`}
                >
                  {days} dias
                </button>
              ))}
            </div>
          </fieldset>

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-xs leading-relaxed text-slate-300">
            <p className="font-bold text-slate-100">Como funcionará</p>
            <p className="mt-1">
              O Kyrub Ads apresentará preço e alcance estimado antes da contratação.
              A distribuição dependerá de aprovação e será identificada como Patrocinado.
              Curtidas, avaliações, XP e posições orgânicas não são comercializados.
            </p>
          </div>

          <p role="status" className="text-xs leading-relaxed text-amber-300">
            Esta é apenas uma prévia. A duração selecionada não é salva,
            nenhuma campanha é criada e nenhum pagamento é iniciado.
            A contratação será habilitada somente após homologação do Kyrub Ads.
          </p>
          <button type="button" onClick={onClose}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 text-sm font-bold text-slate-950">
            Entendi <ArrowUpRight className="h-4 w-4"/>
          </button>
        </div>
      </section>
    </div>
  );
}
