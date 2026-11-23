import { ArrowLeft, ArrowRight, Image as ImageIcon, Trash2 } from 'lucide-react';
import { GooglePhotosImagePickerButton } from '../GooglePhotosImagePickerButton';
import { GoogleDriveImagePickerButton } from '../GoogleDriveImagePickerButton';
import { normalizeStoreMediaImages } from '../../utils/storeMediaCollections';

type Props = {
  id: string;
  title: string;
  description: string;
  images: string[];
  maximum: number;
  onChange: (images: string[]) => void;
  disabled?: boolean;
  onLimit: () => void;
};

export function StoreMediaCollectionEditor({
  id,title,description,images,maximum,onChange,disabled=false,onLimit,
}: Props) {
  const addImage = (url: string): void => {
    if (images.includes(url.trim())) return;
    if (images.length >= maximum) { onLimit(); return; }
    const next = normalizeStoreMediaImages([...images,url],maximum);
    if (next.length <= images.length) { onLimit(); return; }
    onChange(next);
  };
  const move = (index: number,delta: number) => {
    const target=index+delta;
    if (disabled || target<0 || target>=images.length) return;
    const next=[...images];
    [next[index],next[target]]=[next[target],next[index]];
    onChange(next);
  };
  return <section id={id} className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-3">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">{title}</h4>
      <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-300"
        aria-label={`${images.length} de ${maximum} imagens`}>
        {images.length}/{maximum}
      </span>
    </div>
    <p className="text-[11px] leading-relaxed text-slate-400">{description}</p>
    {images.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {images.map((url,index)=><div key={url}
        className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
        <div className="relative h-24">
          <img src={url} alt={`${title}: imagem ${index+1}`} loading="lazy"
            referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          <span className="absolute left-1 top-1 rounded-full bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold text-white">
            {index+1}
          </span>
        </div>
        <div className="flex justify-between gap-1 p-1">
          <button type="button" onClick={()=>move(index,-1)} disabled={disabled||index===0}
            aria-label={`Mover imagem ${index+1} para antes`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-slate-200 disabled:opacity-30">
            <ArrowLeft className="h-4 w-4"/>
          </button>
          <button type="button" onClick={()=>move(index,1)} disabled={disabled||index===images.length-1}
            aria-label={`Mover imagem ${index+1} para depois`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-slate-200 disabled:opacity-30">
            <ArrowRight className="h-4 w-4"/>
          </button>
          <button type="button" onClick={()=>onChange(images.filter((_,i)=>i!==index))} disabled={disabled}
            aria-label={`Remover imagem ${index+1} de ${title}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/20 text-red-300 disabled:opacity-30">
            <Trash2 className="h-4 w-4"/>
          </button>
        </div>
      </div>)}
    </div> : <div className="flex min-h-24 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-950/60 text-[11px] text-slate-500">
      <ImageIcon className="h-5 w-5"/> Nenhuma imagem cadastrada
    </div>}
    {images.length < maximum ? <div className="flex flex-wrap gap-2">
      <GooglePhotosImagePickerButton label="Google Fotos" deviceLabel="Dispositivo"
        onSelect={selection=>addImage(selection.url)} disabled={disabled}/>
      <GoogleDriveImagePickerButton label="Escolher no Drive"
        onSelect={selection=>addImage(selection.url)} disabled={disabled}/>
    </div> : <p className="text-[11px] text-amber-200" role="status">
      Limite de {maximum} imagens atingido. Remova uma imagem para adicionar outra.
    </p>}
  </section>;
}
