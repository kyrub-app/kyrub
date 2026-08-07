import { useRef, useState, type ChangeEvent } from 'react';
import { Images, LoaderCircle, Upload } from 'lucide-react';
import type { GoogleDriveImageSelection } from '../utils/googleDriveMedia';
import { pickGooglePhotosImageToDrive } from '../utils/googlePhotosMedia';
import {
  APP_IMAGE_ACCEPT,
  uploadCurrentUserImage,
} from '../utils/appImageStorage';

interface GooglePhotosImagePickerButtonProps {
  label?: string;
  deviceLabel?: string;
  onSelect: (selection: GoogleDriveImageSelection) => void;
  disabled?: boolean;
  className?: string;
}

export function GooglePhotosImagePickerButton({
  label = 'Selecionar do Google Fotos',
  deviceLabel = 'Dispositivo',
  onSelect,
  disabled = false,
  className = '',
}: GooglePhotosImagePickerButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handlePick = async (): Promise<void> => {
    setErrorMessage('');
    setIsPicking(true);

    try {
      const selection = await pickGooglePhotosImageToDrive();
      if (selection) onSelect(selection);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível importar a foto do Google Fotos.';
      setErrorMessage(message);
    } finally {
      setIsPicking(false);
    }
  };

  const handleDeviceFile = async (
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setErrorMessage('');
    setIsUploading(true);
    try {
      onSelect(await uploadCurrentUserImage(file));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível enviar a imagem para o Kyrub.'
      );
    } finally {
      setIsUploading(false);
    }
  };

  const busy = isPicking || isUploading;

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        accept={APP_IMAGE_ACCEPT}
        className="hidden"
        disabled={disabled || busy}
        onChange={event => void handleDeviceFile(event)}
        aria-label="Enviar imagem do dispositivo"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handlePick()}
          disabled={disabled || busy}
          className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-300 transition-colors hover:border-pink-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        >
          {isPicking ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Images className="h-4 w-4" />
          )}
          {isPicking ? 'Importando foto...' : label}
        </button>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-teal-200 transition-colors hover:border-teal-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        >
          {isUploading ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {isUploading ? 'Enviando...' : deviceLabel}
        </button>
      </div>

      {errorMessage && (
        <p className="max-w-sm text-[10px] leading-relaxed text-red-300">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
