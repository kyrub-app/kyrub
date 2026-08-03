import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  CirclePause,
  CirclePlay,
  LoaderCircle,
  Megaphone,
  Rocket,
  Square,
  X,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../utils/firebase';

type CampaignObjective = 'reach' | 'engagement' | 'messages';
type CampaignStatus = 'active' | 'paused' | 'ended';

type SocialCampaign = {
  id: string;
  campaignId: string;
  ownerId: string;
  postId: string;
  objective: CampaignObjective;
  dailyBudgetCents: number;
  startDate: string;
  endDate: string;
  audienceLocation: string;
  status: CampaignStatus;
};

type SponsorshipRequest = {
  postId?: string;
  authorId?: string;
};

const dateInputValue = (date: Date): string => {
  const adjusted = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000
  );
  return adjusted.toISOString().slice(0, 10);
};

const defaultStartDate = (): string => dateInputValue(new Date());

const defaultEndDate = (): string => {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return dateInputValue(date);
};

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const objectiveLabels: Record<CampaignObjective, string> = {
  reach: 'Alcance',
  engagement: 'Engajamento',
  messages: 'Mensagens',
};

const statusLabels: Record<CampaignStatus, string> = {
  active: 'Ativa',
  paused: 'Pausada',
  ended: 'Encerrada',
};

export function ProfileCampaignManager() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [open, setOpen] = useState(false);
  const [postId, setPostId] = useState('');
  const [postAuthorId, setPostAuthorId] = useState('');
  const [campaigns, setCampaigns] = useState<SocialCampaign[]>([]);
  const [objective, setObjective] =
    useState<CampaignObjective>('reach');
  const [dailyBudget, setDailyBudget] = useState('10');
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [audienceLocation, setAudienceLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [changingId, setChangingId] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(
    () =>
      onAuthStateChanged(auth, nextUser => {
        setUser(nextUser);
        if (!nextUser) {
          setOpen(false);
          setCampaigns([]);
        }
      }),
    []
  );

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const detail = (
        event as CustomEvent<SponsorshipRequest>
      ).detail;

      if (!detail?.postId) return;

      setPostId(detail.postId);
      setPostAuthorId(detail.authorId ?? '');
      setNotice('');
      setOpen(true);
    };

    window.addEventListener(
      'kyrub-sponsor-post-requested',
      handleRequest
    );

    return () =>
      window.removeEventListener(
        'kyrub-sponsor-post-requested',
        handleRequest
      );
  }, []);

  useEffect(() => {
    if (!user) {
      setCampaigns([]);
      return;
    }

    return onSnapshot(
      query(
        collection(db, 'social_post_campaigns'),
        where('ownerId', '==', user.uid)
      ),
      snapshot => {
        setCampaigns(
          snapshot.docs.flatMap(item => {
            const data = item.data() as Record<string, unknown>;
            const status = data.status;
            const objectiveValue = data.objective;

            if (
              status !== 'active' &&
              status !== 'paused' &&
              status !== 'ended'
            ) {
              return [];
            }

            if (
              objectiveValue !== 'reach' &&
              objectiveValue !== 'engagement' &&
              objectiveValue !== 'messages'
            ) {
              return [];
            }

            return [
              {
                id: item.id,
                campaignId:
                  readString(data.campaignId) || item.id,
                ownerId: readString(data.ownerId),
                postId: readString(data.postId),
                objective: objectiveValue,
                dailyBudgetCents:
                  typeof data.dailyBudgetCents === 'number'
                    ? data.dailyBudgetCents
                    : 0,
                startDate: readString(data.startDate),
                endDate: readString(data.endDate),
                audienceLocation:
                  readString(data.audienceLocation),
                status,
              } satisfies SocialCampaign,
            ];
          })
        );
      },
      () => {
        setCampaigns([]);
        setNotice(
          'As campanhas estarão disponíveis após a publicação das novas regras.'
        );
      }
    );
  }, [user]);

  const campaignsForPost = useMemo(
    () =>
      campaigns.filter(
        campaign =>
          campaign.postId === postId &&
          campaign.status !== 'ended'
      ),
    [campaigns, postId]
  );

  const activateCampaign = async (event: FormEvent) => {
    event.preventDefault();

    if (!user || !postId || postAuthorId !== user.uid) {
      setNotice('Não foi possível identificar esta publicação.');
      return;
    }

    const budgetValue = Number(
      dailyBudget.replace(',', '.')
    );
    const dailyBudgetCents = Math.round(budgetValue * 100);

    if (
      !Number.isFinite(dailyBudgetCents) ||
      dailyBudgetCents < 500
    ) {
      setNotice('Informe um orçamento diário de pelo menos R$ 5,00.');
      return;
    }

    if (!startDate || !endDate || endDate < startDate) {
      setNotice('Confira as datas de início e término.');
      return;
    }

    if (!audienceLocation.trim()) {
      setNotice('Informe a localidade do público da campanha.');
      return;
    }

    setBusy(true);
    setNotice('');

    try {
      const reference = doc(
        collection(db, 'social_post_campaigns')
      );

      await setDoc(reference, {
        campaignId: reference.id,
        ownerId: user.uid,
        postId,
        objective,
        dailyBudgetCents,
        startDate,
        endDate,
        audienceLocation: audienceLocation.trim().slice(0, 160),
        status: 'active',
        deliveryMode: 'configuration_only',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNotice('Campanha ativada e salva no painel.');
    } catch {
      setNotice('Não foi possível ativar a campanha.');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (
    campaign: SocialCampaign,
    status: CampaignStatus
  ) => {
    if (!user || campaign.ownerId !== user.uid) return;

    setChangingId(campaign.id);
    setNotice('');

    try {
      await updateDoc(
        doc(db, 'social_post_campaigns', campaign.id),
        {
          status,
          updatedAt: serverTimestamp(),
        }
      );
    } catch {
      setNotice('Não foi possível atualizar a campanha.');
    } finally {
      setChangingId('');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[178] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
      <section className="flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
        <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3">
          <div>
            <span className="text-[9px] font-black uppercase tracking-wider text-orange-400">
              Divulgação
            </span>
            <h3 className="text-base font-black text-white">
              Patrocinar publicação
            </h3>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-slate-500"
            aria-label="Fechar campanhas"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <form
            onSubmit={activateCampaign}
            className="space-y-4 rounded-3xl border border-orange-500/20 bg-orange-500/5 p-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-300">
                <Rocket className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-xs font-black text-white">
                  Nova campanha
                </h4>
                <p className="text-[9px] text-slate-500">
                  Configure objetivo, orçamento, período e público.
                </p>
              </div>
            </div>

            <label className="block">
              <span className="text-[9px] font-black uppercase text-slate-500">
                Objetivo
              </span>
              <select
                value={objective}
                onChange={event =>
                  setObjective(
                    event.target.value as CampaignObjective
                  )
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs text-white outline-none"
              >
                <option value="reach">Aumentar alcance</option>
                <option value="engagement">
                  Gerar engajamento
                </option>
                <option value="messages">
                  Receber mensagens
                </option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[9px] font-black uppercase text-slate-500">
                  Orçamento diário
                </span>
                <div className="mt-1 flex h-11 items-center rounded-xl border border-slate-800 bg-slate-900 px-3">
                  <span className="mr-2 text-xs text-slate-500">
                    R$
                  </span>
                  <input
                    value={dailyBudget}
                    onChange={event =>
                      setDailyBudget(event.target.value)
                    }
                    inputMode="decimal"
                    className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none"
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-[9px] font-black uppercase text-slate-500">
                  Público/localidade
                </span>
                <input
                  value={audienceLocation}
                  onChange={event =>
                    setAudienceLocation(event.target.value)
                  }
                  placeholder="Ex.: São Paulo"
                  maxLength={160}
                  className="mt-1 h-11 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs text-white outline-none"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[9px] font-black uppercase text-slate-500">
                  Início
                </span>
                <input
                  type="date"
                  value={startDate}
                  onChange={event =>
                    setStartDate(event.target.value)
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs text-white outline-none"
                />
              </label>

              <label className="block">
                <span className="text-[9px] font-black uppercase text-slate-500">
                  Término
                </span>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={event =>
                    setEndDate(event.target.value)
                  }
                  className="mt-1 h-11 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs text-white outline-none"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50"
            >
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              Ativar campanha
            </button>
          </form>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <span className="text-[9px] font-black uppercase text-sky-300">
                  Campanhas
                </span>
                <h4 className="text-sm font-black text-white">
                  Ativas nesta publicação
                </h4>
              </div>

              <span className="rounded-full border border-slate-800 bg-slate-900 px-2 py-1 text-[9px] font-black text-slate-400">
                {campaignsForPost.length}
              </span>
            </div>

            <div className="space-y-2">
              {campaignsForPost.map(campaign => (
                <article
                  key={campaign.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900 p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
                      <Megaphone className="h-4 w-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-[10px] text-white">
                          {objectiveLabels[campaign.objective]}
                        </strong>
                        <span className="text-[8px] font-black uppercase text-emerald-300">
                          {statusLabels[campaign.status]}
                        </span>
                      </div>

                      <p className="mt-1 text-[9px] text-slate-500">
                        R${' '}
                        {(
                          campaign.dailyBudgetCents / 100
                        ).toLocaleString('pt-BR', {
                          minimumFractionDigits: 2,
                        })}{' '}
                        por dia · {campaign.startDate} até{' '}
                        {campaign.endDate}
                      </p>

                      <p className="mt-1 truncate text-[9px] text-slate-600">
                        {campaign.audienceLocation}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={changingId === campaign.id}
                      onClick={() =>
                        void changeStatus(
                          campaign,
                          campaign.status === 'active'
                            ? 'paused'
                            : 'active'
                        )
                      }
                      className="flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-700 text-[8px] font-black uppercase text-slate-300 disabled:opacity-50"
                    >
                      {campaign.status === 'active' ? (
                        <CirclePause className="h-4 w-4" />
                      ) : (
                        <CirclePlay className="h-4 w-4" />
                      )}
                      {campaign.status === 'active'
                        ? 'Pausar'
                        : 'Reativar'}
                    </button>

                    <button
                      type="button"
                      disabled={changingId === campaign.id}
                      onClick={() =>
                        void changeStatus(campaign, 'ended')
                      }
                      className="flex h-9 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 text-[8px] font-black uppercase text-red-300 disabled:opacity-50"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Encerrar
                    </button>
                  </div>
                </article>
              ))}

              {campaignsForPost.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center">
                  <Megaphone className="mx-auto h-6 w-6 text-slate-700" />
                  <p className="mt-2 text-[10px] text-slate-500">
                    Nenhuma campanha ativa para esta publicação.
                  </p>
                </div>
              )}
            </div>
          </section>

          <p className="text-[9px] leading-relaxed text-slate-600">
            A ativação registra e gerencia a campanha no Kyrub. A
            cobrança e a distribuição paga serão conectadas ao motor
            de veiculação em uma etapa própria.
          </p>

          {notice && (
            <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[9px] text-slate-300">
              {notice}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}