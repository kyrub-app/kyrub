import { useState } from 'react';
import { Images, LoaderCircle } from 'lucide-react';
import type { GoogleDriveImageSelection } from '../utils/googleDriveMedia';
import { pickGooglePhotosImageToDrive } from '../utils/googlePhotosMedia';

interface GooglePhotosImagePickerButtonProps {
  label?: string;
  onSelect: (selection: GoogleDriveImageSelection) => void;
  disabled?: boolean;
  className?: string;
}

export function GooglePhotosImagePickerButton({
  label = 'Selecionar do Google Fotos',
  onSelect,
  disabled = false,
  className = '',
}: GooglePhotosImagePickerButtonProps) {
  const [isPicking, setIsPicking] = useState(false);
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

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => void handlePick()}
        disabled={disabled || isPicking}
        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-300 transition-colors hover:border-pink-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        {isPicking ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <Images className="h-4 w-4" />
        )}
        {isPicking ? 'Importando foto...' : label}
      </button>

      {errorMessage && (
        <p className="max-w-sm text-[10px] leading-relaxed text-red-300">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
