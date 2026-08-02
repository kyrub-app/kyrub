import {
  useEffect,
  useState,
  type ChangeEvent,
} from 'react';
import {
  BadgeCheck,
  Camera,
  Check,
  FileBadge,
  LoaderCircle,
  Save,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../utils/firebase';
import {
  IDENTITY_CONSENT_VERSION,
  IDENTITY_VERIFICATION_COLLECTION,
  emptyIdentityVerification,
  formatCpf,
  isValidCpf,
  mapIdentityVerification,
  type IdentityDocumentType,
  type IdentityVerificationRecord,
} from '../utils/identityVerification';
import { ProfilePasskeyControls } from './ProfilePasskeyControls';

export type SecureEditorSection = 'documents' | 'biometrics' | 'facial';

type Notice = {
  message: string;
  type: 'success' | 'error' | 'info';
};

const inputClass =
  'w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-orange-500/60';

const safeFileName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(-100);

const statusLabel = (status: IdentityVerificationRecord['status']): string => {
  if (status === 'approved') return 'Aprovado';
  if (status === 'under_review') return 'Em análise';
  if (status === 'submitted') return 'Enviado';
  if (status === 'rejected') return 'Correção necessária';
  return 'Rascunho';
};

export function ProfileSecureEditorSections({
  activeSection,
  user,
  profileName,
}: {
  activeSection: SecureEditorSection;
  user: User;
  profileName: string;
}) {
  const [draft, setDraft] = useState<IdentityVerificationRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'document' | 'selfie' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const reference = doc(db, IDENTITY_VERIFICATION_COLLECTION, user.uid);
    return onSnapshot(
      reference,
      snapshot => {
        const next = snapshot.exists()
          ? mapIdentityVerification(
              user.uid,
              snapshot.data() as Record<string, unknown>,
              profileName || user.displayName || ''
            )
          : emptyIdentityVerification(
              user.uid,
              profileName || user.displayName || ''
            );
        if (!next.fullName) {
          next.fullName = profileName || user.displayName || '';
        }
        setDraft(next);
      },
      () => {
        setNotice({
          message: 'Não foi possível carregar a verificação agora.',
          type: 'error',
        });
      }
    );
  }, [profileName, user]);

  const showNotice = (message: string, type: Notice['type']) => {
    setNotice({ message, type });
  };

  const persistDraft = async () => {
    if (!draft) return;
    if (draft.cpf && !isValidCpf(draft.cpf)) {
      showNotice('Informe um CPF válido ou deixe o campo vazio.', 'error');
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        doc(db, IDENTITY_VERIFICATION_COLLECTION, user.uid),
        {
          uid: user.uid,
          status: draft.status === 'approved' ? 'approved' : 'draft',
          requestedProfiles: draft.requestedProfiles,
          approvedProfiles: draft.approvedProfiles,
          fullName: draft.fullName.trim().slice(0, 160),
          cpf: draft.cpf.replace(/\D/g, ''),
          address: draft.address,
          whatsapp: draft.whatsapp,
          documentType: draft.documentType,
          documentPaths: draft.documentPaths.slice(0, 4),
          selfiePath: draft.selfiePath,
          cnhCategory: draft.cnhCategory.trim().slice(0, 8),
          cnhHasEar: draft.cnhHasEar,
          consentVersion: IDENTITY_CONSENT_VERSION,
          updatedAt: serverTimestamp(),
          createdAt: draft.createdAt ?? serverTimestamp(),
        },
        { merge: true }
      );
      showNotice('Dados de verificação salvos com segurança.', 'success');
    } catch (error) {
      console.error('Secure profile save failed.', error);
      showNotice('Não foi possível salvar os dados agora.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const upload = async (
    event: ChangeEvent<HTMLInputElement>,
    kind: 'document' | 'selfie'
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !draft) return;

    if (file.size > 10 * 1024 * 1024) {
      showNotice('O arquivo deve ter no máximo 10 MB.', 'error');
      return;
    }
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      showNotice('Use JPG, PNG, WEBP ou PDF.', 'error');
      return;
    }
    if (kind === 'selfie' && !file.type.startsWith('image/')) {
      showNotice('A validação facial precisa de uma imagem.', 'error');
      return;
    }

    setUploading(kind);
    try {
      const path = `identity-verification/${user.uid}/${kind}/${Date.now()}-${safeFileName(file.name)}`;
      await uploadBytes(ref(storage, path), file, {
        contentType: file.type,
        customMetadata: {
          ownerId: user.uid,
          purpose: kind,
          consentVersion: IDENTITY_CONSENT_VERSION,
        },
      });

      const next: IdentityVerificationRecord = {
        ...draft,
        documentPaths:
          kind === 'document'
            ? [...draft.documentPaths, path].slice(-4)
            : draft.documentPaths,
        selfiePath: kind === 'selfie' ? path : draft.selfiePath,
      };
      setDraft(next);
      await setDoc(
        doc(db, IDENTITY_VERIFICATION_COLLECTION, user.uid),
        {
          uid: user.uid,
          status: next.status === 'approved' ? 'approved' : 'draft',
          fullName: next.fullName,
          cpf: next.cpf.replace(/\D/g, ''),
          documentType: next.documentType,
          documentPaths: next.documentPaths,
          selfiePath: next.selfiePath,
          cnhCategory: next.cnhCategory,
          cnhHasEar: next.cnhHasEar,
          consentVersion: IDENTITY_CONSENT_VERSION,
          updatedAt: serverTimestamp(),
          createdAt: next.createdAt ?? serverTimestamp(),
        },
        { merge: true }
      );
      showNotice(
        kind === 'document'
          ? 'Documento anexado com segurança.'
          : 'Imagem facial anexada para análise assistida.',
        'success'
      );
    } catch (error) {
      console.error('Secure profile upload failed.', error);
      showNotice('Não foi possível enviar o arquivo agora.', 'error');
    } finally {
      setUploading(null);
    }
  };

  if (!draft) {
    return (
      <div className="flex min-h-52 items-center justify-center rounded-3xl border border-slate-800 bg-slate-900">
        <LoaderCircle className="h-5 w-5 animate-spin text-orange-400" />
      </div>
    );
  }

  const noticeClass = notice?.type === 'success'
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
    : notice?.type === 'error'
      ? 'border-red-500/25 bg-red-500/10 text-red-200'
      : 'border-slate-800 bg-slate-900 text-slate-400';

  return (
    <div className="space-y-4" data-profile-secure-native="true">
      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-teal-300" />
          <span className="text-[9px] font-black uppercase text-slate-300">
            Área segura do perfil
          </span>
        </div>
        <span className="rounded-full bg-slate-950 px-2 py-1 text-[8px] font-black uppercase text-slate-500">
          {statusLabel(draft.status)}
        </span>
      </div>

      {activeSection === 'documents' && (
        <section className="space-y-4 rounded-3xl border border-orange-500/20 bg-orange-500/5 p-4">
          <div className="flex items-start gap-3">
            <FileBadge className="mt-0.5 h-5 w-5 shrink-0 text-orange-300" />
            <div>
              <h4 className="text-[11px] font-black uppercase text-white">
                Documentos
              </h4>
              <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                Seus arquivos são enviados para a área protegida da sua conta e
                não aparecem no perfil público.
              </p>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[9px] font-black uppercase text-slate-500">
              Nome completo
            </span>
            <input
              value={draft.fullName}
              onChange={event =>
                setDraft(current => current
                  ? { ...current, fullName: event.target.value.slice(0, 160) }
                  : current)
              }
              className={inputClass}
              autoComplete="name"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[9px] font-black uppercase text-slate-500">
              CPF
            </span>
            <input
              value={formatCpf(draft.cpf)}
              onChange={event =>
                setDraft(current => current
                  ? { ...current, cpf: event.target.value.replace(/\D/g, '').slice(0, 11) }
                  : current)
              }
              className={inputClass}
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[9px] font-black uppercase text-slate-500">
              Tipo de documento
            </span>
            <select
              value={draft.documentType}
              onChange={event =>
                setDraft(current => current
                  ? {
                      ...current,
                      documentType: event.target.value as IdentityDocumentType,
                    }
                  : current)
              }
              className={inputClass}
            >
              <option value="cin">CIN</option>
              <option value="rg">RG</option>
              <option value="cnh">CNH</option>
            </select>
          </label>

          {draft.documentType === 'cnh' && (
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <label className="block space-y-1.5">
                <span className="text-[9px] font-black uppercase text-slate-500">
                  Categoria
                </span>
                <input
                  value={draft.cnhCategory}
                  onChange={event =>
                    setDraft(current => current
                      ? { ...current, cnhCategory: event.target.value.slice(0, 8) }
                      : current)
                  }
                  className={inputClass}
                  placeholder="Ex.: AB"
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setDraft(current => current
                    ? { ...current, cnhHasEar: !current.cnhHasEar }
                    : current)
                }
                className={`mt-5 flex min-h-11 items-center gap-2 rounded-xl border px-3 text-[9px] font-black uppercase ${
                  draft.cnhHasEar
                    ? 'border-teal-500/30 bg-teal-500/10 text-teal-200'
                    : 'border-slate-800 bg-slate-950 text-slate-500'
                }`}
              >
                {draft.cnhHasEar && <Check className="h-4 w-4" />}
                EAR
              </button>
            </div>
          )}

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-orange-500/30 bg-slate-950 px-4 py-3 text-[10px] font-black uppercase text-orange-200">
            {uploading === 'document' ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Anexar documento
            <input
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={uploading !== null}
              onChange={event => void upload(event, 'document')}
            />
          </label>

          {draft.documentPaths.length > 0 && (
            <p className="flex items-center gap-2 text-[9px] text-emerald-300">
              <BadgeCheck className="h-4 w-4" />
              {draft.documentPaths.length}{' '}
              {draft.documentPaths.length === 1 ? 'arquivo anexado' : 'arquivos anexados'}
            </p>
          )}

          <button
            type="button"
            onClick={() => void persistDraft()}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50"
          >
            {saving ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar documentos
          </button>
        </section>
      )}

      {activeSection === 'biometrics' && (
        <ProfilePasskeyControls user={user} />
      )}

      {activeSection === 'facial' && (
        <section className="space-y-4 rounded-3xl border border-violet-500/20 bg-violet-500/5 p-4">
          <div className="flex items-start gap-3">
            <Camera className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
            <div>
              <h4 className="text-[11px] font-black uppercase text-white">
                Validação facial
              </h4>
              <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                Nesta fase, a imagem é usada em uma prova de vida assistida e
                análise humana. O Kyrub ainda não chama esse processo de
                reconhecimento facial automático.
              </p>
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-[10px] font-black uppercase text-white">
            {uploading === 'selfie' ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            {draft.selfiePath ? 'Substituir imagem facial' : 'Enviar imagem facial'}
            <input
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp"
              capture="user"
              disabled={uploading !== null}
              onChange={event => void upload(event, 'selfie')}
            />
          </label>

          {draft.selfiePath ? (
            <p className="flex items-center gap-2 text-[9px] text-emerald-300">
              <BadgeCheck className="h-4 w-4" />
              Imagem anexada para análise protegida.
            </p>
          ) : (
            <p className="text-[9px] leading-relaxed text-slate-500">
              Nenhuma imagem facial foi enviada. Nada é capturado sem sua ação.
            </p>
          )}
        </section>
      )}

      {notice && (
        <div className={`rounded-2xl border px-3 py-2.5 text-[9px] ${noticeClass}`}>
          {notice.message}
        </div>
      )}
    </div>
  );
}
