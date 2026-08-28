import { useEffect } from 'react';
import { StoreEntitlementLifecycleBridge } from './store/StoreEntitlementLifecycleBridge';

const TEXT_REPLACEMENTS = new Map<string, string>([
  ['Consultor Kyrub', 'Kyrubia'],
  ['O Consultor acompanha o contexto', 'A Kyrubia acompanha o contexto'],
  [
    'Faça sua solicitação em linguagem natural. Nesta primeira fase, o Consultor conversa, orienta e prepara planos sem alterar dados do aplicativo.',
    'Converse com a Kyrubia em linguagem natural. Ela consulta o Kyrub e executa ações habilitadas, como criar notas, ativar sua loja e cadastrar produtos, respeitando as confirmações e autorizações necessárias.',
  ],
  [
    'Converse com a Kyrubia em linguagem natural. Ela responde, cria notas com confirmação e ajuda a enxergar próximos caminhos.',
    'Converse com a Kyrubia em linguagem natural. Ela consulta o Kyrub e executa ações habilitadas, como criar notas, ativar sua loja e cadastrar produtos, respeitando as confirmações e autorizações necessárias.',
  ],
  ['Sem ações', 'Ações seguras'],
  [
    'Ações no aplicativo ainda exigem o modo manual nesta primeira fase.',
    'A Kyrubia executa as ações habilitadas pelo Kyrub quando houver autorização ou confirmação necessária. O modo manual continua disponível.',
  ],
  [
    'A Kyrubia cria notas após sua confirmação. Outras ações continuam disponíveis no modo manual.',
    'A Kyrubia executa as ações habilitadas pelo Kyrub quando houver autorização ou confirmação necessária. O modo manual continua disponível.',
  ],
  [
    'Olá! Conte o que você precisa. Vou ajudar a organizar a solicitação e os próximos passos.',
    'Olá! Eu sou a Kyrubia. Conte o que você precisa e vou ajudar a organizar o pedido, os próximos passos e oportunidades relacionadas.',
  ],
  [
    'Não foi possível conectar ao servidor da Kyrub I.A. Verifique sua internet e tente novamente.',
    'Não foi possível conectar ao servidor da Kyrubia. Verifique sua internet e tente novamente.',
  ],
]);

const replaceExactText = (root: ParentNode): void => {
  root
    .querySelectorAll<HTMLElement>('span, h2, h3, p, strong, div')
    .forEach(element => {
      if (element.children.length > 0) return;
      const current = element.textContent?.trim() ?? '';
      const replacement = TEXT_REPLACEMENTS.get(current);
      if (replacement && current !== replacement) {
        element.textContent = replacement;
      }
    });
};

const syncKyrubiaIdentity = (): void => {
  document.querySelectorAll<HTMLButtonElement>('nav button').forEach(button => {
    const label = button.querySelector<HTMLElement>('span');
    const text = label?.textContent?.trim();
    if (label && (text === 'Kyrub I.A' || text === 'Kyrubia')) {
      label.textContent = 'Kyrubia';
      button.setAttribute('aria-label', 'Abrir Kyrubia');
    }
  });

  const workspace = document.getElementById('kyrub-ai-workspace');
  if (!workspace) return;

  workspace.setAttribute('data-kyrubia', 'true');
  replaceExactText(workspace);

  workspace
    .querySelectorAll<HTMLElement>('[aria-label="Capacidades atuais da Kyrub I.A"]')
    .forEach(element => {
      element.setAttribute('aria-label', 'Capacidades atuais da Kyrubia');
    });
};

export function KyrubiaNamingBridge() {
  useEffect(() => {
    let scheduled = false;
    const scheduleSync = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        syncKyrubiaIdentity();
      });
    };

    scheduleSync();
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const interval = window.setInterval(scheduleSync, 750);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  return <StoreEntitlementLifecycleBridge />;
}
