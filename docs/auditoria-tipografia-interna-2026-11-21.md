# KYRUB — Auditoria de tipografia interna (21/11/2026)

## Objetivo e referência

Uniformizar a **legibilidade da guia Catu/Renda** nos fluxos pessoais, ERP do lojista e Control Plane, preservando a hierarquia entre títulos, texto comum, legendas e controles.

O componente `RendaTab` usa, como referência, `text-[10px]` para descrições e botões (14px na renderização com a ampliação existente de +4px) e `text-xs` para títulos de cards (16px renderizados). Dados auxiliares podem ser 1px menores (13px); títulos de página são maiores.

## Evidências da vistoria estática

- **28 arquivos TSX do Control Plane**, examinados individualmente: 3 ocorrências de `text-[7px]`, 31 de `text-[8px]`, 112 de `text-[9px]` e 107 de `text-[10px]`.
- **142 arquivos TSX em `src/components/store/`**, examinados individualmente: 93 ocorrências de `text-[7px]`, 606 de `text-[8px]`, 749 de `text-[9px]` e 554 de `text-[10px]`.
- O teste automatizado também **percorre recursivamente todos os arquivos TSX de `src/`**, incluindo as telas pessoais e os demais componentes. A quantidade e a distribuição por família são registradas em cada execução do CI.
- Existem componentes de modais renderizados por React Portal em `document.body` que não recebem o ajuste comum de `#root` sem marcação explícita. O `AppModalLayoutBridge` já aplica uma escala própria em parte desses diálogos.

*As contagens são ocorrências literais de classes no código-fonte, não contagens de telas visitadas, texto efetivamente exibido ou cobertura funcional.*

## Correção transversal

1. Manter a ampliação já existente de **+4px**, porém estabelecer piso de **13px** para o texto renderizado nas superfícies geridas pelo hook. A fonte de corpo da Renda continua 14px.
2. Atingir as rotas pessoais, ERP e administração renderizadas sob `#root`, sem criar 142 correções pontuais concorrentes.
3. Registrar os overlays de ERP e demais diálogos autogerenciados montados diretamente em `document.body` como superfícies tipográficas próprias; observar apenas a entrada do marcador `data-kyrub-font-scope`, nunca classes alteradas por cliques.
4. Nos diálogos tratados pelo `AppModalLayoutBridge`, elevar a 13px as antigas escalas de 7/8px e impedir ampliação duplicada pelo hook.
5. Preservar regras de segurança, escopo dos produtos/planos, dados, permissões, rotas, scroll e estrutura operacional do ERP.

## Critérios de aceitação

- Títulos e dados principais continuam distintos, sem converter todos os textos em uma única fonte.
- Textos de apoio mantêm pelo menos 13px nas superfícies geridas; descrições comuns equivalentes às da Renda ficam em 14px.
- Controles de tela e diálogos continuam utilizáveis em telas estreitas, inclusive com labels longas.
- A atualização por navegação ou montagem de modal não reamplia fontes que já foram ajustadas.
- Nenhum overlay de terceiro é ampliado sem ser um dos contextos Kyrub selecionados.
- O CI deve aprovar TypeScript, testes gerais e contratos da interface.

## Limites da comprovação

A auditoria **estática e automatizada** alcança o catálogo de componentes e rotas do repositório, mas **não é uma validação visual completa dos estados reais de cada tela**. Em particular, contas/permissões, dados que habilitam menus, Android/WebView, formulários densos e modalidades de abertura de modais exigem inspeção visual autenticada.

Uma tela não deve ser declarada "validada visualmente" apenas porque o CI passou. A conferência final em celular deve considerar Catu, Praça/Comunidades, Central Pessoal, notificações, entradas `/staff` e ERP (produtos, pedidos, caixa, equipe, folha, assinaturas, financeiro, fiscal, integrações) e Control Plane com uma conta administrativa autorizada.

## Segurança da integração

Não desabilitar verificações, não alterar regras Firestore, não habilitar pagamento, e não inventar testes visuais. Integrar somente após verificação de CI e preview. A publicação de produção pode ocorrer via merge após testes automatizados; a comprovação visual por perfis autorizados permanece uma etapa de aceite distinta.
