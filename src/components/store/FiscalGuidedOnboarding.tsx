import React, { useEffect, useState } from 'react';
import { ExternalLink, HelpCircle, KeyRound, ShieldCheck } from 'lucide-react';
import { auth } from '../../utils/firebase';

type HelpTopic = 'a1' | 'csc' | 'mei' | null;

type FiscalGuidedOnboardingProps = {
  canonicalStoreId: string;
};

const profileEndpoint = '/api/store-connections/fiscal/profile';
const SP_NFCE_URL = 'https://portal.fazenda.sp.gov.br/servicos/nfce';
const SP_NFF_URL = 'https://portal.fazenda.sp.gov.br/servicos/nff';

const externalLinkClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-white transition hover:border-cyan-500/40';

export const FiscalGuidedOnboarding: React.FC<FiscalGuidedOnboardingProps> = ({ canonicalStoreId }) => {
  const [topic, setTopic] = useState<HelpTopic>(null);
  const [fiscalState, setFiscalState] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const response = await fetch(`${profileEndpoint}?canonicalStoreId=${encodeURIComponent(canonicalStoreId)}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({})) as { address?: { state?: unknown } };
        if (!active) return;
        const state = typeof payload.address?.state === 'string' ? payload.address.state.trim().toUpperCase() : '';
        setFiscalState(state.slice(0, 2));
      } catch {
        // Guidance is optional and must never block the canonical Fiscal workspace.
      }
    })();
    return () => { active = false; };
  }, [canonicalStoreId]);

  const isSp = fiscalState === 'SP';
  const toggle = (next: Exclude<HelpTopic, null>) => setTopic(current => current === next ? null : next);

  return <section className="space-y-4 rounded-3xl border border-cyan-500/20 bg-slate-900 p-5 text-white" id="kyrub-fiscal-guided-onboarding">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><HelpCircle className="h-5 w-5 text-cyan-300" /><h3 className="text-xs font-black uppercase">Assistente de configuração fiscal</h3></div>
        <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">Ainda não tem certificado ou não sabe onde conseguir o CSC? O Kyrub orienta o próximo passo sem marcar requisitos como concluídos antes da hora.</p>
      </div>
      {fiscalState && <span className="shrink-0 rounded-full border border-slate-700 px-2 py-1 font-mono text-[8px] font-black uppercase text-slate-400">UF fiscal: {fiscalState}</span>}
    </div>

    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <button type="button" onClick={() => toggle('a1')} aria-expanded={topic === 'a1'} className="min-h-20 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-left transition hover:border-cyan-500/30">
        <ShieldCheck className="h-4 w-4 text-cyan-300" />
        <strong className="mt-2 block text-[10px] uppercase">Não tenho certificado A1</strong>
        <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">Entenda o que é e como providenciar sem enviar senha ou arquivo pelo chat.</span>
      </button>
      <button type="button" onClick={() => toggle('csc')} aria-expanded={topic === 'csc'} className="min-h-20 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-left transition hover:border-cyan-500/30">
        <KeyRound className="h-4 w-4 text-cyan-300" />
        <strong className="mt-2 block text-[10px] uppercase">Como obter meu CSC?</strong>
        <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">Veja de onde vêm o idCSC e o código de segurança da NFC-e.</span>
      </button>
      <button type="button" onClick={() => toggle('mei')} aria-expanded={topic === 'mei'} className="min-h-20 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-left transition hover:border-cyan-500/30">
        <HelpCircle className="h-4 w-4 text-cyan-300" />
        <strong className="mt-2 block text-[10px] uppercase">Sou MEI / estou começando</strong>
        <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">Confira caminhos simplificados disponíveis para pequenos negócios.</span>
      </button>
    </div>

    {topic === 'a1' && <div className="space-y-3 rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
      <h4 className="text-[10px] font-black uppercase text-cyan-100">Certificado A1: o que fazer se você ainda não tem</h4>
      <p className="text-[10px] leading-relaxed text-slate-300">O A1 é o certificado digital da empresa usado na assinatura de documentos fiscais no fluxo integrado convencional. Ele não é criado automaticamente quando o CNPJ é aberto.</p>
      <div className="grid grid-cols-1 gap-2 text-[9px] leading-relaxed text-slate-400 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">1. Confirme se já existe</strong>Consulte sua contabilidade e procure por arquivos .pfx ou .p12 e mensagens sobre certificado digital.</div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">2. Se não existir</strong>Providencie o certificado com uma autoridade certificadora adequada à empresa e guarde a senha com segurança.</div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">3. Depois</strong>Cadastre o arquivo e a senha diretamente na área protegida do Fiscal Kyrub. Não envie esses dados por mensagem.</div>
      </div>
      <p className="text-[9px] leading-relaxed text-amber-200">O Kyrub não recomenda comprar um certificado apenas para “deixar o check verde”. Primeiro confirme qual modalidade fiscal realmente se aplica à empresa.</p>
    </div>}

    {topic === 'csc' && <div className="space-y-3 rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
      <h4 className="text-[10px] font-black uppercase text-cyan-100">CSC da NFC-e</h4>
      {isSp ? <>
        <p className="text-[10px] leading-relaxed text-slate-300">Para estabelecimento em São Paulo, o CSC é obtido no ambiente da SEFAZ-SP após o credenciamento para NFC-e. No portal, a função de gerenciamento do Código de Segurança fornece o código e seu identificador (idCSC).</p>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[9px] leading-relaxed text-slate-400"><strong className="block text-white">Sequência esperada</strong>Credenciar o estabelecimento para NFC-e → acessar o gerenciamento do Código de Segurança → gerar/consultar CSC e idCSC → cadastrar ambos diretamente no Kyrub.</div>
        <a className={externalLinkClass} href={SP_NFCE_URL} target="_blank" rel="noreferrer">Abrir portal oficial NFC-e/SP <ExternalLink className="h-3.5 w-3.5" /></a>
      </> : <>
        <p className="text-[10px] leading-relaxed text-slate-300">O CSC é fornecido pela administração tributária competente para a NFC-e e o procedimento varia por UF. O Kyrub não reutiliza instruções de São Paulo para uma empresa registrada em outro estado.</p>
        <p className="text-[9px] leading-relaxed text-slate-400">Consulte o portal oficial da SEFAZ da sua UF para credenciamento de NFC-e e geração do CSC/idCSC. Depois, cadastre os valores diretamente no cofre Fiscal do Kyrub.</p>
      </>}
      <p className="text-[9px] leading-relaxed text-amber-200">CSC é segredo fiscal. O código não deve ser enviado por chat, e-mail aberto ou campo de observação.</p>
    </div>}

    {topic === 'mei' && <div className="space-y-3 rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
      <h4 className="text-[10px] font-black uppercase text-cyan-100">Caminho para quem está começando</h4>
      {isSp ? <>
        <p className="text-[10px] leading-relaxed text-slate-300">Para MEI em São Paulo, existe também a Nota Fiscal Fácil (NFF), oferecida pela SEFAZ-SP como caminho simplificado pelo celular. Ela é uma alternativa externa ao emissor integrado do Kyrub e não será tratada como se configurasse automaticamente A1 ou CSC dentro da plataforma.</p>
        <p className="text-[9px] leading-relaxed text-slate-400">Isso permite ao empreendedor entender primeiro qual caminho atende ao negócio antes de contratar certificado ou configurar uma integração mais completa.</p>
        <a className={externalLinkClass} href={SP_NFF_URL} target="_blank" rel="noreferrer">Conhecer a Nota Fiscal Fácil/SP <ExternalLink className="h-3.5 w-3.5" /></a>
      </> : <>
        <p className="text-[10px] leading-relaxed text-slate-300">Regimes simplificados e alternativas para MEI variam conforme o documento fiscal, atividade e localidade. O Kyrub vai orientar por UF sem presumir que uma solução estadual serve para todo o país.</p>
        <p className="text-[9px] leading-relaxed text-slate-400">Por enquanto, confirme sua UF fiscal, atividade e orientação contábil antes de contratar certificado ou habilitar emissão integrada.</p>
      </>}
    </div>}

    <p className="text-[9px] leading-relaxed text-slate-500">Este assistente explica o caminho, mas não altera sozinho credenciais, habilitação fiscal, homologação ou autorização de produção.</p>
  </section>;
};
