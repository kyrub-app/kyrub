import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CircleAlert,
  ExternalLink,
  FileBadge,
  LoaderCircle,
  ShieldCheck,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { auth, db, storage } from '../../utils/firebase';
import {
  subscribeToAdminProfile,
  type AdminProfile,
} from '../../utils/adminControlPlane';
import {
  IDENTITY_VERIFICATION_COLLECTION,
  mapIdentityVerification,
  type IdentityVerificationRecord,
  type VerificationStatus,
} from '../../utils/identityVerification';

const statusLabel = (status: VerificationStatus): string => {
  if (status === 'approved') return 'Aprovado';
  if (status === 'under_review') return 'Em análise';
  if (status === 'submitted') return 'Aguardando análise';
  if (status === 'rejected') return 'Correção solicitada';
  return 'Rascunho';
};

const maskCpf = (cpf: string): string => {
  const digits = cpf.replace(/\D/g, '');
  return digits.length === 11 ? `***.***.***-${digits.slice(-2)}` : 'CPF não informado';
};

const profileLabel = (profile: string): string => ({
  requester: 'Contratante',
  freelancer: 'Freelancer',
  bicycle_courier: 'Entregador bike',
  motorized_courier: 'Entregador motorizado',
}[profile] ?? profile);

export default function AdminIdentityVerificationWorkspace() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [records, setRecords] = useState<IdentityVerificationRecord[]>([]);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let unsubscribeProfile = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, nextUser => {
      unsubscribeProfile();
      unsubscribeProfile = () => undefined;
      setUser(nextUser);
      setProfile(null);
      if (!nextUser) return;
      unsubscribeProfile = subscribeToAdminProfile(
        nextUser,
        nextProfile => setProfile(nextProfile),
        () => setProfile(null)
      );
    });
    return () => {
      unsubscribeProfile();
      unsubscribeAuth();
    };
  }, []);

  const canReview = profile?.status === 'active'
    && ['super_admin', 'operations', 'compliance'].includes(profile.role);

  useEffect(() => {
    if (!canReview) return;
    return onSnapshot(
      query(collection(db, IDENTITY_VERIFICATION_COLLECTION), limit(100)),
      snapshot => {
        setRecords(snapshot.docs.map(item =>
          mapIdentityVerification(
            item.id,
            item.data() as Record<string, unknown>
          )
        ));
      },
      () => setMessage('Não foi possível carregar as verificações.')
    );
  }, [canReview]);

  const ordered = useMemo(
    () => [...records].sort((left, right) => {
      const weight = (status: VerificationStatus) => ({
        submitted: 0,
        under_review: 1,
        rejected: 2,
        approved: 3,
        draft: 4,
      }[status]);
      return weight(left.status) - weight(right.status);
    }),
    [records]
  );

  if (!user || !canReview) return null;

  const review = async (
    record: IdentityVerificationRecord,
    status: 'under_review' | 'approved' | 'rejected'
  ) => {
    const reason = status === 'rejected'
      ? window.prompt('Explique objetivamente o que precisa ser corrigido:')?.trim()
      : '';
    if (status === 'rejected' && !reason) return;

    setBusyId(record.uid);
    setMessage('');
    try {
      await updateDoc(doc(db, IDENTITY_VERIFICATION_COLLECTION, record.uid), {
        status,
        approvedProfiles: status === 'approved' ? record.requestedProfiles : [],
        reviewReason: reason || '',
        reviewedBy: user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setMessage(
        status === 'approved'
          ? 'Verificação aprovada.'
          : status === 'rejected'
            ? 'Correção solicitada ao usuário.'
            : 'Análise iniciada.'
      );
    } catch (error) {
      console.error('Identity verification review failed.', error);
      setMessage('Não foi possível atualizar esta análise.');
    } finally {
      setBusyId('');
    }
  };

  const openFile = async (path: string) => {
    try {
      const url = await getDownloadURL(ref(storage, path));
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Identity verification file open failed.', error);
      setMessage('Não foi possível abrir o arquivo protegido.');
    }
  };

  return (
    <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6">
      <div className="rounded-[2rem] border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="rounded-2xl bg-violet-500/10 p-3 text-violet-300">
              <UserRoundCheck className="h-5 w-5" />
            </span>
            <div>
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-400">
                KYC e elegibilidade
              </span>
              <h2 className="mt-1 text-lg font-black text-white">
                Verificações de identidade
              </h2>
              <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-500">
                Documentos são privados. A aprovação habilita somente os perfis analisados e não substitui obrigações legais específicas da atividade.
              </p>
            </div>
          </div>
          <span className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-[9px] font-black uppercase text-slate-400">
            {ordered.length} registros
          </span>
        </div>

        {message && (
          <div className="mt-4 flex gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-[10px] text-slate-300">
            <CircleAlert className="h-4 w-4 shrink-0 text-amber-300" />
            {message}
          </div>
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {ordered.map(record => (
            <article key={record.uid} className="rounded-3xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-black text-white">
                    {record.fullName || record.uid}
                  </h3>
                  <p className="mt-1 text-[9px] font-mono text-slate-500">
                    {maskCpf(record.cpf)} · {record.documentType.toUpperCase()}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${
                  record.status === 'approved'
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : record.status === 'rejected'
                      ? 'bg-red-500/10 text-red-300'
                      : 'bg-amber-500/10 text-amber-300'
                }`}>
                  {statusLabel(record.status)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {record.requestedProfiles.map(item => (
                  <span key={item} className="rounded-full border border-slate-800 px-2 py-1 text-[8px] text-slate-400">
                    {profileLabel(item)}
                  </span>
                ))}
              </div>

              {record.requestedProfiles.includes('motorized_courier') && (
                <div className="mt-3 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-3 text-[9px] text-violet-200">
                  CNH categoria {record.cnhCategory || 'não informada'} · EAR {record.cnhHasEar ? 'declarado' : 'não declarado'}
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                {record.documentPaths.map((path, index) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => void openFile(path)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[9px] font-black uppercase text-slate-300"
                  >
                    <FileBadge className="h-4 w-4 text-violet-300" />
                    Documento {index + 1}
                    <ExternalLink className="h-3 w-3" />
                  </button>
                ))}
                {record.selfiePath && (
                  <button
                    type="button"
                    onClick={() => void openFile(record.selfiePath)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[9px] font-black uppercase text-slate-300"
                  >
                    <ShieldCheck className="h-4 w-4 text-orange-300" />
                    Selfie
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </div>

              {record.reviewReason && (
                <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-[9px] text-red-200">
                  {record.reviewReason}
                </p>
              )}

              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-900 pt-3">
                <button
                  type="button"
                  disabled={busyId === record.uid}
                  onClick={() => void review(record, 'under_review')}
                  className="rounded-xl border border-slate-800 px-2 py-2 text-[8px] font-black uppercase text-slate-300 disabled:opacity-50"
                >
                  {busyId === record.uid ? <LoaderCircle className="mx-auto h-4 w-4 animate-spin" /> : 'Analisar'}
                </button>
                <button
                  type="button"
                  disabled={busyId === record.uid}
                  onClick={() => void review(record, 'rejected')}
                  className="flex items-center justify-center gap-1 rounded-xl border border-red-500/20 bg-red-500/5 px-2 py-2 text-[8px] font-black uppercase text-red-300 disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" /> Corrigir
                </button>
                <button
                  type="button"
                  disabled={busyId === record.uid}
                  onClick={() => void review(record, 'approved')}
                  className="flex items-center justify-center gap-1 rounded-xl bg-emerald-500 px-2 py-2 text-[8px] font-black uppercase text-slate-950 disabled:opacity-50"
                >
                  <BadgeCheck className="h-3.5 w-3.5" /> Aprovar
                </button>
              </div>
            </article>
          ))}

          {ordered.length === 0 && (
            <div className="lg:col-span-2 rounded-3xl border border-dashed border-slate-800 px-5 py-12 text-center text-xs text-slate-500">
              Nenhuma solicitação de verificação foi enviada.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
