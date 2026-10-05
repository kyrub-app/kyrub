import React, { useEffect, useState } from 'react';
import { ExternalLink, HelpCircle, KeyRound, ShieldCheck, Smartphone, Sparkles } from 'lucide-react';
import { auth } from '../../utils/firebase';

type HelpTopic = 'a1' | 'csc' | 'mei' | null;

type FiscalGuidedOnboardingProps = {
  canonicalStoreId: string;
};

const profileEndpoint = '/api/store-connections/fiscal/profile';
const SP_NFCE_URL = 'https://portal.fazenda.sp.gov.br/servicos/nfce';
const NFF_PLAY_URL = 'https://play.google.com/store/apps/details?id=br.gov.rs.procergs.nff';
const NFF_APPLE_URL = 'https://apps.apple.com/br/app/nota-fiscal-f%C3%A1cil-nff/id1531717982';

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
        <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">Ainda não tem certificado ou não sabe onde conseguir o CSC? O Kyrub explica o caminho aqui mesmo e só direciona para fora quando você realmente precisa executar uma etapa externa.</p>
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
        <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">Entenda a Nota Fiscal Fácil e quando ela pode ser uma alternativa.</span>
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

    {topic === 'mei' && <div className="space-y-4 rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
      <div>
        <div className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-cyan-300" /><h4 className="text-[10px] font-black uppercase text-cyan-100">Nota Fiscal Fácil (NFF)</h4></div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-300">A Nota Fiscal Fácil é um regime especial de âmbito nacional, instituído pelo Ajuste SINIEF 37/19, para simplificar a emissão de documentos fiscais eletrônicos. Ela atende públicos como transportadores autônomos, microempreendedores individuais e produtores primários, conforme a implantação e as regras de cada UF.</p>
      </div>

      <div className="grid grid-cols-1 gap-2 text-[9px] leading-relaxed text-slate-400 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">Sem certificado digital</strong>O aplicativo NFF permite preencher e solicitar a emissão de documentos fiscais sem exigir certificado A1 para esse fluxo simplificado.</div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">Gratuito no celular</strong>O app é gratuito e está disponível para Android e iPhone. A proposta é reduzir a complexidade técnica para quem está começando.</div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">Pode funcionar off-line</strong>A NFF prevê operação simplificada com recursos de contingência/off-line e armazenamento no aparelho, conforme o módulo e as regras aplicáveis.</div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><strong className="block text-white">É complementar</strong>A NFF não substitui obrigatoriamente os emissores convencionais. O contribuinte pode usar caminhos diferentes de emissão conforme sua necessidade e enquadramento.</div>
      </div>

      {isSp ? <div className="space-y-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3">
        <strong className="block text-[9px] uppercase text-emerald-200">Para sua UF fiscal: São Paulo</strong>
        <p className="text-[9px] leading-relaxed text-slate-300">Em São Paulo, a NFF está disponível para Transportadores Autônomos de Cargas (TAC) e, desde 16/09/2024, também para MEI e Produtor Rural. Para MEI e Produtor Rural, o fluxo paulista contempla NF-e e NFC-e em operações como vendas e devoluções, inclusive conforme as regras aplicáveis a operações internas ou interestaduais.</p>
        <p className="text-[9px] leading-relaxed text-slate-400">Isso significa que um MEI paulista pode avaliar a NFF antes de contratar certificado apenas para começar a emitir. A escolha não configura automaticamente o emissor integrado do Kyrub nem marca A1 ou CSC como concluídos aqui.</p>
      </div> : <div className="space-y-2 rounded-xl border border-amber-500/15 bg-amber-500/5 p-3">
        <strong className="block text-[9px] uppercase text-amber-200">Disponibilidade depende da sua UF</strong>
        <p className="text-[9px] leading-relaxed text-slate-300">A NFF é nacional, mas a implantação por público e documento fiscal pode variar por estado. O Kyrub não presume que o recorte paulista vale para sua empresa.</p>
      </div>}

      <div className="space-y-2">
        <p className="text-[9px] font-black uppercase text-slate-300">Baixar o aplicativo oficial</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a className={externalLinkClass} href={NFF_PLAY_URL} target="_blank" rel="noreferrer">Android / Google Play <ExternalLink className="h-3.5 w-3.5" /></a>
          <a className={externalLinkClass} href={NFF_APPLE_URL} target="_blank" rel="noreferrer">iPhone / App Store <ExternalLink className="h-3.5 w-3.5" /></a>
        </div>
      </div>
    </div>}

    <div className="flex items-start gap-3 rounded-2xl border border-violet-500/15 bg-violet-500/5 p-4">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
      <div><strong className="block text-[9px] uppercase text-violet-200">Próxima evolução com a Kyrubia</strong><p className="mt-1 text-[9px] leading-relaxed text-slate-400">Futuramente, o assistente poderá oferecer “Pedir para a Kyrubia preparar minhas informações fiscais”, organizando o checklist e os dados necessários antes de qualquer ação sensível. O botão só será ativado quando esse agente estiver realmente conectado ao fluxo fiscal.</p></div>
    </div>

    <p className="text-[9px] leading-relaxed text-slate-500">Este assistente explica o caminho, mas não altera sozinho credenciais, habilitação fiscal, homologação ou autorização de produção.</p>
  </section>;
};
