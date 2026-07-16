import React, { useState, useEffect } from 'react';
import { Briefcase } from 'lucide-react';
import { db } from '../../utils/firebase';
import { deleteDoc, doc } from 'firebase/firestore';
import { FreelanceJob } from '../../types';

interface FreelaManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'employer' | 'employee';
  freelanceJobs: FreelanceJob[];
  setFreelanceJobs: React.Dispatch<React.SetStateAction<FreelanceJob[]>>;
  profileName: string;
  walletHistory?: any[];
  setWalletHistory?: React.Dispatch<React.SetStateAction<any[]>>;
  setWalletBalance?: React.Dispatch<React.SetStateAction<number>>;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export const FreelaManagerModal: React.FC<FreelaManagerModalProps> = ({
  isOpen,
  onClose,
  mode,
  freelanceJobs,
  setFreelanceJobs,
  profileName,
  walletHistory = [],
  setWalletHistory,
  setWalletBalance,
  triggerToast,
}) => {
  // Modal interior tab states
  const [freelaModalTab, setFreelaModalTab] = useState<'solicitar' | 'publicados' | 'historico'>('solicitar');
  const [fazerFreelasModalTab, setFazerFreelasModalTab] = useState<'solicitacoes' | 'fazendo' | 'historico'>('solicitacoes');

  // Solicitar Freela (Form states)
  const [freelaTitle, setFreelaTitle] = useState('');
  const [freelaDesc, setFreelaDesc] = useState('');
  const [freelaRequirements, setFreelaRequirements] = useState('');
  const [freelaPayment, setFreelaPayment] = useState('');
  const [editingFreelaId, setEditingFreelaId] = useState<string | null>(null);

  // Set default tabs when modal opens or mode changes
  useEffect(() => {
    if (isOpen) {
      if (mode === 'employer') {
        setFreelaModalTab('solicitar');
      } else {
        setFazerFreelasModalTab('solicitacoes');
      }
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  // Handler for creating/updating a freela
  const handleCreateFreela = (e: React.FormEvent) => {
    e.preventDefault();
    if (!freelaTitle || !freelaDesc || !freelaPayment) {
      triggerToast('Por favor, preencha todos os campos do freela!', 'error');
      return;
    }
    const paymentNum = parseFloat(freelaPayment);
    if (isNaN(paymentNum) || paymentNum <= 0) {
      triggerToast('Por favor, insira um valor de pagamento válido!', 'error');
      return;
    }

    if (editingFreelaId) {
      setFreelanceJobs(prev =>
        prev.map(job => {
          if (job.id === editingFreelaId) {
            return {
              ...job,
              title: freelaTitle,
              description: `${freelaDesc} ${freelaRequirements ? `(Requisitos: ${freelaRequirements})` : ''}`,
              payment: paymentNum,
              updatedAt: new Date().toISOString()
            } as any;
          }
          return job;
        })
      );
      setEditingFreelaId(null);
      setFreelaTitle('');
      setFreelaDesc('');
      setFreelaRequirements('');
      setFreelaPayment('');
      setFreelaModalTab('publicados');
      triggerToast('Oportunidade de freela atualizada com sucesso!', 'success');
    } else {
      const newFreela: FreelanceJob = {
        id: `fre-${Date.now()}`,
        title: freelaTitle,
        employer: profileName || 'Você',
        description: `${freelaDesc} (Requisitos: ${freelaRequirements})`,
        payment: paymentNum,
        distance: parseFloat((Math.random() * 3 + 0.5).toFixed(1)),
        status: 'open'
      };
      setFreelanceJobs([newFreela, ...freelanceJobs]);
      setFreelaTitle('');
      setFreelaDesc('');
      setFreelaRequirements('');
      setFreelaPayment('');
      setFreelaModalTab('publicados');
      triggerToast('Oportunidade de freela publicada com sucesso!', 'success');
    }
  };

  // Handler for deleting a freela
  const handleDeleteFreelanceJob = async (id: string) => {
    setFreelanceJobs(prev => prev.filter(job => job.id !== id));
    try {
      await deleteDoc(doc(db, 'freelance_jobs', id));
      triggerToast('Freela excluído com sucesso da nuvem!', 'success');
    } catch (e) {
      console.error('Error deleting freelance job:', e);
      triggerToast('Removido localmente.', 'info');
    }
  };

  // Worker apply to a job
  const handleApplyFreelance = (gigId: string) => {
    setFreelanceJobs(prev =>
      prev.map(g => {
        if (g.id !== gigId) return g;
        triggerToast(`Sua candidatura para "${g.title}" foi enviada para ${g.employer}!`, 'success');
        return { ...g, status: 'applied' };
      })
    );
  };

  // Worker completes a job
  const handleSimulateGigDone = (gigId: string) => {
    setFreelanceJobs(prev =>
      prev.map(g => {
        if (g.id !== gigId) return g;
        if (setWalletBalance) {
          setWalletBalance(curr => curr + g.payment);
        }
        if (setWalletHistory) {
          setWalletHistory(currHistory => [
            { id: `tx-gig-${Date.now()}`, type: 'Serviço Gig', desc: `Faturamento freela: ${g.title}`, val: g.payment, date: new Date().toLocaleString('pt-BR') },
            ...currHistory
          ]);
        }
        triggerToast(`Parabéns! Trabalho concluído e R$ ${g.payment.toFixed(2)} recebidos.`, 'success');
        return { ...g, status: 'done' };
      })
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id={mode === 'employer' ? 'modal-solicitar-freela' : 'modal-fazer-freelas'}>
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg p-6 rounded-3xl shadow-2xl relative space-y-4 max-h-[85vh] overflow-y-auto animate-scale-up">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <h3 className="text-base font-black text-white flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-teal-400" />
            <span>{mode === 'employer' ? 'Gestão de Freelas Kyrub' : 'Painel Freelancer Kyrub'}</span>
          </h3>
          <button 
            onClick={() => {
              onClose();
              setEditingFreelaId(null);
            }}
            className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>

        {mode === 'employer' ? (
          /* ==============================================================
             SOLICITANTE (EMPLOYER) TABS AND CONTENT
             ============================================================== */
          <>
            {/* Abas */}
            <div className="flex border-b border-slate-800 text-[10px] font-bold font-mono">
              <button
                type="button"
                onClick={() => setFreelaModalTab('solicitar')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  freelaModalTab === 'solicitar' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Solicitar Serviço
              </button>
              <button
                type="button"
                onClick={() => setFreelaModalTab('publicados')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  freelaModalTab === 'publicados' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Publicados
              </button>
              <button
                type="button"
                onClick={() => setFreelaModalTab('historico')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  freelaModalTab === 'historico' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Histórico
              </button>
            </div>

            {/* Conteúdo da Aba Solicitar */}
            {freelaModalTab === 'solicitar' && (
              <form onSubmit={handleCreateFreela} className="space-y-4 text-xs">
                {editingFreelaId && (
                  <div className="p-3 bg-teal-500/10 border border-teal-500/20 rounded-xl text-teal-400 text-[10px] flex justify-between items-center">
                    <span>Modo Edição Ativo (ID: {editingFreelaId})</span>
                    <button 
                      type="button" 
                      onClick={() => {
                        setEditingFreelaId(null);
                        setFreelaTitle('');
                        setFreelaDesc('');
                        setFreelaRequirements('');
                        setFreelaPayment('');
                      }}
                      className="text-xs hover:underline uppercase font-bold text-teal-400"
                    >
                      Cancelar
                    </button>
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Título do Serviço</label>
                    <input 
                      type="text" 
                      value={freelaTitle}
                      onChange={(e) => setFreelaTitle(e.target.value)}
                      placeholder="ex: Fotógrafo Auxiliar ou Repositor"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-teal-500" 
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Descrição do Freela</label>
                    <textarea 
                      value={freelaDesc}
                      onChange={(e) => setFreelaDesc(e.target.value)}
                      placeholder="Descreva o que o freelancer precisa fazer..."
                      rows={2}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-teal-500" 
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Requisitos Básicos</label>
                    <input 
                      type="text" 
                      value={freelaRequirements}
                      onChange={(e) => setFreelaRequirements(e.target.value)}
                      placeholder="ex: Trazer câmera própria ou ter experiência"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-teal-500" 
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Pagamento Oferecido (R$)</label>
                    <input 
                      type="number" 
                      value={freelaPayment}
                      onChange={(e) => setFreelaPayment(e.target.value)}
                      placeholder="ex: 150.00"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-teal-500" 
                      required
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-3 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      setEditingFreelaId(null);
                    }}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all cursor-pointer"
                  >
                    Fechar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition-all uppercase tracking-wider cursor-pointer"
                  >
                    {editingFreelaId ? 'Atualizar Freela' : 'Publicar Freela'}
                  </button>
                </div>
              </form>
            )}

            {/* Conteúdo da Aba Publicados */}
            {freelaModalTab === 'publicados' && (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1 text-xs">
                {freelanceJobs.filter(job => 
                  (job.employer === (profileName || 'Você') || job.employer === 'Você') && job.status !== 'done'
                ).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic">
                    Nenhum freela publicado ativo encontrado.
                  </div>
                ) : (
                  freelanceJobs.filter(job => 
                    (job.employer === (profileName || 'Você') || job.employer === 'Você') && job.status !== 'done'
                  ).map(job => (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-3">
                      <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                          <h4 className="text-xs font-black text-white uppercase">{job.title}</h4>
                          <p className="text-[11px] text-slate-400 leading-relaxed pt-1">{job.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-black text-teal-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                          <span className="text-[9px] px-1.5 py-0.5 mt-1 bg-slate-900 border border-slate-800 text-slate-400 rounded font-mono uppercase font-semibold inline-block">
                            {job.status === 'open' ? 'Aberto' : 'Candidatura'}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2.5 pt-2 border-t border-slate-900/80">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFreelaId(job.id);
                            setFreelaTitle(job.title);
                            // Strip Requisitos text if appended in standard structure
                            const matchRequirements = job.description.match(/\(Requisitos: (.*?)\)/);
                            if (matchRequirements && matchRequirements[1]) {
                              setFreelaRequirements(matchRequirements[1]);
                              setFreelaDesc(job.description.replace(/\s*\(Requisitos:.*?\)/, ''));
                            } else {
                              setFreelaRequirements('');
                              setFreelaDesc(job.description);
                            }
                            setFreelaPayment(job.payment.toString());
                            setFreelaModalTab('solicitar');
                          }}
                          className="flex-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold py-1.5 rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteFreelanceJob(job.id)}
                          className="flex-1 bg-red-950/40 hover:bg-red-900/45 border border-red-900/50 text-red-400 font-bold py-1.5 rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Conteúdo da Aba Histórico */}
            {freelaModalTab === 'historico' && (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1 text-xs">
                {freelanceJobs.filter(job => 
                  (job.employer === (profileName || 'Você') || job.employer === 'Você') && job.status === 'done'
                ).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic">
                    Nenhum histórico de freela finalizado encontrado.
                  </div>
                ) : (
                  freelanceJobs.filter(job => 
                    (job.employer === (profileName || 'Você') || job.employer === 'Você') && job.status === 'done'
                  ).map(job => (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-2">
                      <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                          <h4 className="text-xs font-black text-slate-300 uppercase">{job.title}</h4>
                          <p className="text-[11px] text-slate-500 leading-relaxed pt-1">{job.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-bold text-slate-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                          <span className="text-[9px] px-1.5 py-0.5 mt-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded font-mono uppercase font-black inline-block">
                            Concluído
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        ) : (
          /* ==============================================================
             TRABALHADOR (FREELANCER) TABS AND CONTENT
             ============================================================== */
          <>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Trabalhe de forma independente prestando serviços sob demanda para as lojas parceiras. Acompanhe suas candidaturas e execute as tarefas aceitas.
            </p>

            {/* Abas */}
            <div className="flex border-b border-slate-800 text-[10px] font-bold font-mono">
              <button
                type="button"
                onClick={() => setFazerFreelasModalTab('solicitacoes')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  fazerFreelasModalTab === 'solicitacoes' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Solicitações
              </button>
              <button
                type="button"
                onClick={() => setFazerFreelasModalTab('fazendo')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  fazerFreelasModalTab === 'fazendo' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Fazendo
              </button>
              <button
                type="button"
                onClick={() => setFazerFreelasModalTab('historico')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  fazerFreelasModalTab === 'historico' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Histórico
              </button>
            </div>

            {/* Aba Solicitações */}
            {fazerFreelasModalTab === 'solicitacoes' && (
              <div className="space-y-3">
                {freelanceJobs.filter(job => job.status === 'open').length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                    Nenhuma vaga freelancer aberta disponível no momento.
                  </div>
                ) : (
                  freelanceJobs.filter(job => job.status === 'open').map(job => (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors space-y-3">
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1 min-w-0 text-xs">
                          <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                            Contratante: {job.employer}
                          </span>
                          <h4 className="text-xs font-black text-white mt-1.5 truncate">{job.title}</h4>
                          <p className="text-[11px] text-slate-400 leading-relaxed pt-1">{job.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-black text-teal-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                          <span className="text-[9px] text-slate-500 font-mono">{job.distance} KM</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-900/80 pt-3">
                        <span className="text-[9px] text-teal-400 bg-teal-400/5 border border-teal-400/20 px-2 py-0.5 rounded-full font-bold font-mono uppercase">
                          Aberta
                        </span>
                        <button
                          onClick={() => handleApplyFreelance(job.id)}
                          className="px-3.5 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono"
                        >
                          Candidatar-se
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Aba Fazendo */}
            {fazerFreelasModalTab === 'fazendo' && (
              <div className="space-y-3">
                {freelanceJobs.filter(job => job.status === 'applied').length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                    Nenhum freela aceito em andamento no momento.
                  </div>
                ) : (
                  freelanceJobs.filter(job => job.status === 'applied').map(job => (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors space-y-3">
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1 min-w-0 text-xs">
                          <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                            Contratante: {job.employer}
                          </span>
                          <h4 className="text-xs font-black text-white mt-1.5 truncate">{job.title}</h4>
                          <p className="text-[11px] text-slate-400 leading-relaxed pt-1">{job.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-black text-teal-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                          <span className="text-[9px] text-slate-500 font-mono">{job.distance} KM</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-900/80 pt-3">
                        <span className="text-[9px] text-orange-400 bg-orange-400/5 border border-orange-400/20 px-2 py-0.5 rounded-full font-bold font-mono uppercase">
                          Em Andamento
                        </span>
                        <button
                          onClick={() => handleSimulateGigDone(job.id)}
                          className="px-3.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono"
                        >
                          Concluir Trabalho
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Aba Histórico */}
            {fazerFreelasModalTab === 'historico' && (
              <div className="space-y-3">
                {freelanceJobs.filter(job => job.status === 'done').length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                    Você não possui histórico de freelas concluídos.
                  </div>
                ) : (
                  freelanceJobs.filter(job => job.status === 'done').map(job => (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-2 text-xs">
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1 min-w-0">
                          <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                            Contratante: {job.employer}
                          </span>
                          <h4 className="text-xs font-black text-slate-300 mt-1.5 truncate">{job.title}</h4>
                          <p className="text-[11px] text-slate-500 leading-relaxed pt-1">{job.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-bold text-slate-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                          <span className="text-[9px] px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full font-bold font-mono uppercase inline-block mt-1">
                            Pago
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-[11px] transition-all uppercase tracking-wider cursor-pointer"
              >
                Voltar ao Painel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
