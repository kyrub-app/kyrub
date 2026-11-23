import { Users } from 'lucide-react';

interface CommunityCardBackdropProps {
  coverImage?: string;
}

/** One photographic surface for the entire card; all controls render above this layer. */
export function CommunityCardBackdrop({ coverImage }: CommunityCardBackdropProps) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {coverImage ? (
        <img
          src={coverImage}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-sky-950 via-emerald-950 to-slate-900">
          <Users className="h-11 w-11 text-sky-300/40" aria-hidden="true" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/65 to-slate-950/25" />
    </div>
  );
}
