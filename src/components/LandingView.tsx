import React from 'react';
import { Zap } from 'lucide-react';

interface LandingViewProps {
  showLoginModal: boolean;
  setShowLoginModal: (val: boolean) => void;
  handleLogin: (provider: 'google' | 'apple') => void;
  setCurrentPath: (path: string) => void;
}

export function LandingView({
  showLoginModal,
  setShowLoginModal,
  handleLogin,
  setCurrentPath
}: LandingViewProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]" id="landing-page">
      <div className="w-full max-w-md text-center space-y-8">
        <div className="space-y-4">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-orange-500 to-teal-500 flex items-center justify-center shadow-2xl shadow-orange-500/10">
            <Zap className="w-9 h-9 text-slate-950 animate-pulse" />
          </div>
          <h1 className="text-4xl font-black text-white tracking-tight uppercase">Bem-vinda(o) a Kyrub</h1>
          <p className="text-slate-400 text-sm max-w-sm mx-auto">
            O ecossistema multi-tenant B2B2C completo para fornecedores, varejistas e profissionais de delivery.
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl space-y-6">
          <button
            onClick={() => setShowLoginModal(true)}
            className="w-full py-4 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-2xl transition-all shadow-lg shadow-orange-600/20 uppercase tracking-widest text-xs"
          >
            Entrar na Plataforma
          </button>
          <div className="flex justify-center gap-6 text-[10px] text-slate-500 font-mono uppercase">
            <span>Google Cloud Run</span>
            <span>•</span>
            <span>Cloudflare Guard</span>
          </div>
        </div>

        <button
          onClick={() => {
            window.history.pushState({}, '', '/staff');
            setCurrentPath('/staff');
          }}
          className="mt-6 text-[10px] text-slate-500 hover:text-orange-400 font-mono uppercase tracking-widest transition-colors cursor-pointer border border-slate-900 hover:border-orange-500/20 px-4 py-2 rounded-xl bg-slate-950"
          id="btn-goto-staff"
        >
          ⚙️ Acesso Operacional Staff
        </button>
      </div>

      {/* LOGIN MODAL */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl w-full max-w-sm space-y-6 shadow-2xl">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-black text-white uppercase tracking-wider">Identidade Kyrub</h3>
              <p className="text-xs text-slate-400">Escolha um provedor para autenticar de forma segura.</p>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => handleLogin('google')}
                className="w-full py-3 bg-white hover:bg-slate-100 text-slate-900 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-3"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M12 5.04c1.66 0 3.2.57 4.38 1.69l3.27-3.27C17.68 1.54 14.98 1 12 1 7.35 1 3.37 3.65 1.39 7.5l3.85 2.99c.92-2.76 3.51-4.45 6.76-4.45z"/>
                  <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.34H12v4.44h6.45c-.28 1.48-1.12 2.73-2.38 3.58l3.7 2.87c2.16-1.99 3.42-4.92 3.42-8.55z"/>
                  <path fill="#FBBC05" d="M5.24 10.49c-.24-.72-.37-1.49-.37-2.29s.13-1.57.37-2.29L1.39 2.92C.5 4.71 0 6.71 0 8.8s.5 4.09 1.39 5.88l3.85-2.99z"/>
                  <path fill="#34A853" d="M12 18.96c3.25 0 5.97-1.07 7.96-2.91l-3.7-2.87c-1.11.75-2.52 1.19-4.26 1.19-3.25 0-5.84-1.69-6.76-4.45L1.39 12.92c1.98 3.85 5.96 6.04 10.61 6.04z"/>
                </svg>
                <span>Continuar com Google</span>
              </button>
              <button
                onClick={() => handleLogin('apple')}
                className="w-full py-3 bg-slate-950 hover:bg-black text-white border border-slate-800 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-3"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.22.67-2.94 1.5-.63.73-1.18 1.87-1.03 2.98 1.12.09 2.27-.58 2.98-1.42z"/>
                </svg>
                <span>Continuar com Apple</span>
              </button>
            </div>
            <button
              onClick={() => setShowLoginModal(false)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold rounded-xl text-xs transition-all"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
