import { useRef } from 'react';
import {
  Camera,
  FileText,
  Image as ImageIcon,
  Paperclip,
  X,
} from 'lucide-react';
import type { KyrubAiAttachmentRef } from '../../shared/aiConsultant';
import { mergeKyrubiaAttachmentFiles } from '../ai/kyrubiaAttachmentService';

const ACCEPTED_FILES = 'image/jpeg,image/png,image/webp,application/pdf';

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 10 ? 1 : 2)} MB`;
};

export const KyrubAiAttachmentSummary = ({
  attachments,
}: {
  attachments: KyrubAiAttachmentRef[];
}) => {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Anexos desta mensagem">
      {attachments.map(attachment => {
        const Icon = attachment.mimeType === 'application/pdf' ? FileText : ImageIcon;
        return (
          <span
            key={attachment.id}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-white/15 bg-black/15 px-2 py-1 text-[11px] text-inherit"
            title={`${attachment.name} · ${formatBytes(attachment.size)}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-40 truncate">{attachment.name}</span>
          </span>
        );
      })}
    </div>
  );
};

export function KyrubAiAttachmentPicker({
  files,
  onChange,
  onError,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = (selected: FileList | null) => {
    if (!selected?.length) return;
    try {
      const next = mergeKyrubiaAttachmentFiles(files, Array.from(selected));
      onChange(next);
      onError('');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Não foi possível anexar esse arquivo.');
    }
  };

  return (
    <div className="mt-2">
      <input
        ref={filesInputRef}
        type="file"
        accept={ACCEPTED_FILES}
        multiple
        className="hidden"
        onChange={event => {
          addFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
        aria-label="Escolher imagens ou PDF"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={event => {
          addFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
        aria-label="Tirar foto com a câmera"
      />

      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" aria-label="Anexos selecionados">
          {files.map((file, index) => {
            const Icon = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
              ? FileText
              : ImageIcon;
            return (
              <span
                key={`${file.name}-${file.lastModified}-${index}`}
                className="inline-flex max-w-full items-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/10 px-2.5 py-2 text-xs text-violet-100"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="max-w-40 truncate">{file.name}</span>
                <span className="shrink-0 text-[10px] text-violet-300/80">
                  {formatBytes(file.size)}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(files.filter((_item, itemIndex) => itemIndex !== index))}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-40"
                  aria-label={`Remover ${file.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => filesInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-2 text-xs font-bold text-slate-300 hover:border-violet-500/40 hover:text-violet-200 disabled:opacity-40"
          aria-label="Anexar imagens ou PDF"
        >
          <Paperclip className="h-4 w-4" />
          Anexar
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => cameraInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-2 text-xs font-bold text-slate-300 hover:border-violet-500/40 hover:text-violet-200 disabled:opacity-40"
          aria-label="Tirar foto"
        >
          <Camera className="h-4 w-4" />
          Câmera
        </button>
        <span className="text-[10px] text-slate-600">JPG, PNG, WEBP ou PDF</span>
      </div>
    </div>
  );
}
