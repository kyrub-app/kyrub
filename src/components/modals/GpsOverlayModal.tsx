import React from 'react';
import { MapPin } from 'lucide-react';

interface GpsOverlayModalProps {
  isOpen: boolean;
  handleGpsPermission: (granted: boolean) => void;
}

export const GpsOverlayModal: React.FC<GpsOverlayModalProps> = ({
  isOpen,
  handleGpsPermission
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl w-full max-w-sm space-y-5 text-center shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-24 h-24 bg-orange-500/5 rounded-full blur-2xl" />
        <div className="w-12 h-12 bg-orange-950 border border-orange-900/60 text-orange-400 rounded-2xl flex items-center justify-center mx-auto">
          <MapPin className="w-6 h-6" />
        </div>
        
        <div className="space-y-2">
          <h3 className="text-base font-black text-white uppercase tracking-wider">Acesso ao GPS Necessário</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Kyrub deseja acessar sua localização por GPS para encontrar lojistas, entregadores e amigos próximos por proximidade geográfica.
          </p>
        </div>

        <div className="space-y-2.5">
          <button
            onClick={() => handleGpsPermission(true)}
            className="w-full py-3 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black rounded-xl text-xs transition-all uppercase tracking-widest"
          >
            Permitir Acesso ao GPS
          </button>
          <button
            onClick={() => handleGpsPermission(false)}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold rounded-xl text-xs transition-all uppercase"
          >
            Recusar e Continuar
          </button>
        </div>
      </div>
    </div>
  );
};
