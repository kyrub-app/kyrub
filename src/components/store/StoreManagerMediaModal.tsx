import { useEffect, useState } from 'react';
import { Image as ImageIcon, Trash2, X } from 'lucide-react';
import { auth } from '../../utils/firebase';
import { GooglePhotosImagePickerButton } from '../GooglePhotosImagePickerButton';
import { GoogleDriveImagePickerButton } from '../GoogleDriveImagePickerButton';
import { StoreMediaCollectionEditor } from './StoreMediaCollectionEditor';
import {
  MAX_STORE_BANNER_IMAGES,MAX_STORE_GALLERY_IMAGES,
  normalizeStoreMediaImages,
} from '../../utils/storeMediaCollections';

type State = {logo:string;bannerImages:string[];galleryImages:string[];version:number};
type Props = {isOpen:boolean;legacyStoreId:string;storeName:string;onClose:()=>void};
const initial:State={logo:'',bannerImages:[],galleryImages:[],version:0};

export function StoreManagerMediaModal({isOpen,legacyStoreId,storeName,onClose}:Props) {
  const [media,setMedia]=useState<State>(initial);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [done,setDone]=useState('');

  useEffect(()=>{
    if(!isOpen||!legacyStoreId)return;
    let cancelled=false;
    setLoading(true);setError('');setDone('');setMedia(initial);
    const load=async()=>{
      const user=auth.currentUser;
      if(!user)throw Error('Faça login novamente.');
      const res=await fetch('/api/staff/store-media?storeId='+encodeURIComponent(legacyStoreId),{
        headers:{Authorization:'Bearer '+await user.getIdToken()},cache:'no-store',
      });
      const data=await res.json().catch(()=>({})) as Partial<State>&{error?:string};
      if(!res.ok||!Array.isArray(data.bannerImages)||!Array.isArray(data.galleryImages)||
        typeof data.version!=='number')throw Error(data.error||'Não foi possível carregar as imagens.');
      if(!cancelled)setMedia({
        logo:typeof data.logo==='string'?data.logo:'',
        bannerImages:normalizeStoreMediaImages(data.bannerImages,MAX_STORE_BANNER_IMAGES),
        galleryImages:normalizeStoreMediaImages(data.galleryImages,MAX_STORE_GALLERY_IMAGES),
        version:data.version,
      });
    };
    void load().catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Falha ao carregar.');})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[isOpen,legacyStoreId]);

  const save=async()=>{
    const user=auth.currentUser;
    if(!user||saving||loading)return;
    setSaving(true);setError('');setDone('');
    try{
      const res=await fetch('/api/staff/store-media',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},
        body:JSON.stringify({storeId:legacyStoreId,...media,expectedVersion:media.version}),
      });
      const data=await res.json().catch(()=>({})) as Partial<State>&{error?:string};
      if(!res.ok||typeof data.version!=='number')throw Error(data.error||'Não foi possível salvar.');
      setMedia(current=>({...current,version:data.version!}));
      setDone('Imagens atualizadas na vitrine da loja.');
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}
    finally{setSaving(false);}
  };

  if(!isOpen)return null;
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/90 p-3 backdrop-blur-md">
    <section role="dialog" aria-modal="true" aria-labelledby="store-manager-media-heading"
      className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 text-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 p-4">
        <div>
          <h2 id="store-manager-media-heading" className="text-sm font-black uppercase">Configurações da Loja</h2>
          <p className="mt-1 text-[11px] text-slate-400">{storeName} · Mídia pública (gestor)</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar configurações" disabled={saving}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 disabled:opacity-40"><X className="h-5 w-5"/></button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {loading?<p role="status" className="text-sm text-slate-300">Carregando mídias da loja...</p>:<>
          <div className="space-y-3 rounded-2xl border border-slate-700 p-3">
            <h3 className="text-xs font-black uppercase text-white">Logo</h3>
            <div className="flex h-24 items-center justify-center rounded-xl border border-slate-700 bg-slate-950">
              {media.logo?<img src={media.logo} alt="Logo atual da loja" referrerPolicy="no-referrer" className="h-full w-full object-contain"/>:<ImageIcon className="h-7 w-7 text-slate-600"/>}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <GooglePhotosImagePickerButton label="Logo no Google Fotos" onSelect={selection=>setMedia(c=>({...c,logo:selection.url}))} disabled={saving}/>
              <GoogleDriveImagePickerButton label="Escolher logo no Drive" onSelect={selection=>setMedia(c=>({...c,logo:selection.url}))} disabled={saving}/>
              {media.logo&&<button type="button" onClick={()=>setMedia(c=>({...c,logo:''}))} disabled={saving}
                className="flex min-h-10 items-center gap-2 rounded-xl border border-red-500/30 px-3 text-[11px] text-red-200">
                <Trash2 className="h-4 w-4"/>Remover
              </button>}
            </div>
          </div>
          <StoreMediaCollectionEditor id="manager-store-banner-images"
            title="Banner rotativo" description="Até cinco imagens para a capa, na ordem escolhida."
            images={media.bannerImages} maximum={MAX_STORE_BANNER_IMAGES}
            disabled={saving} onChange={bannerImages=>setMedia(c=>({...c,bannerImages}))}
            onLimit={()=>setError('O banner permite até cinco imagens.')}/>
          <StoreMediaCollectionEditor id="manager-store-gallery-images"
            title="Galeria de imagens" description="Imagens do estabelecimento, separadas do catálogo."
            images={media.galleryImages} maximum={MAX_STORE_GALLERY_IMAGES}
            disabled={saving} onChange={galleryImages=>setMedia(c=>({...c,galleryImages}))}
            onLimit={()=>setError('A galeria permite até 24 imagens.')}/>
        </>}
        {error&&<p role="alert" className="text-xs text-red-300">{error}</p>}
        {done&&<p role="status" className="text-xs text-emerald-300">{done}</p>}
      </div>
      <footer className="flex shrink-0 justify-end gap-3 border-t border-slate-700 p-4">
        <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-bold">Fechar</button>
        <button type="button" onClick={()=>void save()} disabled={saving||loading||Boolean(error)}
          className="min-h-11 rounded-xl bg-orange-500 px-5 text-xs font-black uppercase text-slate-950 disabled:opacity-40">
          {saving?'Salvando...':'Salvar'}
        </button>
      </footer>
    </section>
  </div>;
}
