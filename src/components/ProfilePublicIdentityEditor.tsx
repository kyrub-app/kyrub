import { PublicSocialAddressEditor } from './PublicSocialAddressEditor';
import { reconcileProfileCompletionPilot } from '../utils/profileCompletionPilot';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, LoaderCircle, RotateCcw, Save, UserRound } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { updateProfile, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db, storage } from '../utils/firebase';

type PublicProfileDraft = { name: string; bio: string; photoUrl: string };
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTOS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};
const broadcastProfileUpdate = (user: User, name: string, photoUrl: string) => {
  window.dispatchEvent(new CustomEvent('kyrub:profile-updated', {
    detail: { uid: user.uid, name, photoUrl },
  }));
};

/** The only visible editor for photo, name and biography.
 * Sensitive identity documents are never stored in the public profile.
 */
export function ProfilePublicIdentityEditor({ user }: { user: User }) {
  const [draft, setDraft] = useState<PublicProfileDraft>({
    name: user.displayName || '', bio: '', photoUrl: user.photoURL || '',
  });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [googlePhoto, setGooglePhoto] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setMessage('');
    const originalGoogle = user.providerData.find(provider => provider.providerId === 'google.com')?.photoURL
      || localStorage.getItem('kyrub_google_profile_photo_' + user.uid)
      || user.photoURL || '';
    setGooglePhoto(originalGoogle);
    void Promise.all([
      getDoc(doc(db, 'users', user.uid)),
      getDoc(doc(db, 'users', user.uid, 'public_profile', 'main')),
    ]).then(([account, publicProfile]) => {
      if (cancelled) return;
      const accountData = account.data() as Record<string, unknown> | undefined;
      const publicData = publicProfile.data() as Record<string, unknown> | undefined;
      const clean = (value: unknown) => typeof value === 'string' ? value : '';
      setDraft({
        name: clean(publicData?.name) || clean(accountData?.name) || user.displayName || '',
        bio: clean(publicData?.bio).slice(0, 280),
        photoUrl: clean(publicData?.photoUrl) || clean(accountData?.photoUrl) || user.photoURL || '',
      });
    }).catch(() => {
      if (!cancelled) {
        setLoadFailed(true);
        setMessage('Não foi possível carregar seu perfil. Feche e reabra quando estiver conectado. Nenhuma edição será enviada.');
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user.uid]);

  const savePublicProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || photoBusy || loading || loadFailed) return;
    const name = draft.name.trim().slice(0, 80);
    const bio = draft.bio.trim().slice(0, 280);
    if (!name) {
      setMessage('Informe o nome de exibição.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const fields = { name, photoUrl: draft.photoUrl, updatedAt: serverTimestamp() };
      const batch=writeBatch(db);
      batch.set(doc(db, 'users', user.uid), fields, { merge: true });
      batch.set(doc(db, 'users', user.uid, 'public_profile', 'main'),
        { userId: user.uid, ...fields, bio }, { merge: true });
      await batch.commit();
      if(auth.currentUser!==user)return;
      setDraft(current => ({ ...current, name, bio }));
      broadcastProfileUpdate(user, name, draft.photoUrl);
      setMessage('Foto, nome e biografia sincronizados.');
      void reconcileProfileCompletionPilot(user);
      try {
        await updateProfile(user, { displayName: name, photoURL: draft.photoUrl || null });
      } catch (error) {
        console.warn('Perfil salvo; sincronização do nome de autenticação pendente.',error);
        if(auth.currentUser===user)setMessage('Perfil salvo. Sincronização da conta pendente.');
      }
    } catch (error) {
      console.error('Não foi possível salvar o perfil público:', error);
      setMessage('Falha ao sincronizar. Tente salvar novamente.');
    } finally {
      setSaving(false);
    }
  };

  const setPhoto = async (photoUrl: string) => {
    if (loadFailed) return;
    setPhotoBusy(true);
    setMessage('');
    try {
      const name = draft.name.trim().slice(0, 80) || user.displayName || 'Usuário Kyrub';
      const fields = { photoUrl, updatedAt: serverTimestamp() };
      await Promise.all([
        setDoc(doc(db, 'users', user.uid), fields, { merge: true }),
        setDoc(doc(db, 'users', user.uid, 'public_profile', 'main'),
          { userId: user.uid, name, bio: draft.bio.trim().slice(0, 280), ...fields }, { merge: true }),
      ]);
      await updateProfile(user, { photoURL: photoUrl || null });
      setDraft(current => ({ ...current, photoUrl }));
      broadcastProfileUpdate(user, name, photoUrl);
      setMessage('Foto do perfil atualizada.');
    } catch (error) {
      console.error('Falha ao atualizar foto:', error);
      setMessage('Não foi possível salvar a foto. Tente novamente.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const uploadPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || loadFailed) return;
    const extension = ALLOWED_PHOTOS[file.type];
    if (!extension || file.size > MAX_PHOTO_BYTES) {
      setMessage('Use JPG, PNG ou WEBP de até 8 MB.');
      return;
    }
    setPhotoBusy(true);
    setMessage('');
    try {
      const target = ref(storage, 'profile-images/' + user.uid + '/avatar.' + extension);
      await uploadBytes(target, file, { contentType: file.type });
      const photoUrl = await getDownloadURL(target);
      // setPhoto remains responsible for the canonical cloud and Auth writes.
      await setPhoto(photoUrl);
    } catch (error) {
      console.error('Falha no upload da foto:', error);
      setMessage('Não foi possível enviar a imagem ao Firebase Storage.');
    } finally {
      setPhotoBusy(false);
    }
  };

  if (loading) return (
    <div className="flex min-h-52 items-center justify-center text-sm text-slate-400">
      <LoaderCircle className="mr-2 h-5 w-5 animate-spin" /> Carregando perfil…
    </div>
  );

  return (
    <section className="space-y-4" id="unified-public-profile-editor" aria-label="Perfil público">
      <header className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4">
        <h3 className="text-base font-black text-white">Perfil e identidade</h3>
        <p className="mt-1 text-sm text-slate-400">
          Foto, nome e biografia. Controle a descoberta do perfil na Central Pessoal.
        </p>
      </header>
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center gap-3">
          {draft.photoUrl
            ? <img src={draft.photoUrl} alt="Foto do seu perfil" referrerPolicy="no-referrer"
                className="h-20 w-20 rounded-2xl border border-slate-700 object-cover" />
            : <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-950 text-slate-400"><UserRound className="h-8 w-8" /></div>}
          <div className="min-w-0">
            <strong className="block truncate text-base text-white">{draft.name || 'Seu perfil'}</strong>
            <p className="mt-1 truncate text-xs text-slate-400">{user.email}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <label className={'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-orange-500 px-3 text-sm font-bold text-slate-950 ' + (photoBusy ? 'opacity-50' : '')}>
            <Camera className="h-4 w-4" aria-hidden="true" />
            {photoBusy ? 'Enviando…' : 'Alterar foto'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
              disabled={photoBusy || saving || loadFailed} onChange={event => void uploadPhoto(event)} />
          </label>
          <button type="button" disabled={!googlePhoto || photoBusy || saving || loadFailed}
            onClick={() => void setPhoto(googlePhoto)}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 text-sm font-bold text-slate-200 disabled:opacity-50">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Usar Google
          </button>
        </div>
      </div>
      <PublicSocialAddressEditor key={user.uid} kind="profile" ownerId={user.uid} onReserved={()=>void reconcileProfileCompletionPilot(user)} />
      <form className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4" onSubmit={event => void savePublicProfile(event)}>
        <label className="block text-sm font-semibold text-slate-200">
          Nome de exibição
          <input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value.slice(0, 80) }))}
            maxLength={80} required autoComplete="nickname"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white" />
        </label>
        <label className="block text-sm font-semibold text-slate-200">
          Biografia
          <textarea value={draft.bio} onChange={event => setDraft(current => ({ ...current, bio: event.target.value.slice(0, 280) }))}
            maxLength={280} rows={4}
            className="mt-2 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-base text-white" />
          <span className="mt-1 block text-right text-xs text-slate-400">{draft.bio.length}/280</span>
        </label>
        <button type="submit" disabled={saving || photoBusy || loadFailed}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-black text-slate-950 disabled:opacity-50">
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar perfil
        </button>
        <p role="status" className="flex items-center gap-2 text-xs leading-relaxed text-slate-300">
          {message.startsWith('Foto,') || message.startsWith('Foto do')
            ? <Check className="h-4 w-4 text-teal-300" /> : null}
          {message}
        </p>
      </form>
    </section>
  );
}
