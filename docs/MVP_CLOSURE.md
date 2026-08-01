# Fechamento do MVP do Kyrub

## Objetivo

Declarar o Kyrub apto para um beta fechado sem confundir quantidade de funcionalidades com prontidão operacional.

O MVP é considerado fechado quando os fluxos principais funcionam de ponta a ponta, falhas conhecidas possuem saída segura e nenhuma tela apresenta simulações como dados reais.

## Núcleo já presente

- login Google e cadastro mínimo do usuário;
- perfil e diretório social;
- conexões e mensagens privadas;
- loja por usuário, catálogo e vitrine pública;
- produtos, estoque, pedidos e operação;
- notas, checklist, lembretes e colaboração;
- painel administrativo separado;
- sincronização entre dispositivos e cache offline;
- Kyrubia com criação confirmada de nota;
- testes de regras, contratos, migração e operação.

## Critérios técnicos de fechamento

- [x] TypeScript executado sem emissão.
- [x] Build de cliente e servidor definido.
- [x] Regras Firestore compostas e testáveis em emulador.
- [x] Rotas administrativas separadas da conta comum.
- [x] Chaves da IA restritas ao servidor.
- [x] Ações da Kyrubia exigem confirmação.
- [x] Tela de recuperação para falhas fatais do cliente.
- [x] Endpoint geral de saúde sem exposição de segredos.
- [x] Documentação de ambiente, release e incidente.
- [ ] Monitoramento externo de erros configurado em produção.
- [ ] Política de backup e restauração testada com dados reais controlados.
- [ ] Exclusão de conta e retenção de dados aprovadas jurídica e tecnicamente.

## Critérios de experiência

- [ ] Fluxo de usuário novo testado em celular e desktop.
- [ ] Perfil revisado sem controles demonstrativos ambíguos.
- [ ] Painel gerencial revisado com dados reais, indisponíveis ou explicitamente planejados.
- [ ] Estados vazios orientam a próxima ação.
- [ ] Erros permitem tentar novamente ou sair do fluxo.
- [ ] Modais longos preservam cabeçalho, ações e rolagem.
- [ ] Navegação por teclado e leitor de tela validada nos fluxos essenciais.
- [ ] Uso em conexão instável validado.

## Critérios de segurança e privacidade

- [ ] Termos de uso aprovados.
- [ ] Política de privacidade aprovada.
- [ ] Canal de contato do titular definido.
- [ ] Denúncia e bloqueio definidos para conteúdo e usuários.
- [ ] Fluxo de exclusão de conta definido, incluindo dados compartilhados e obrigações legais.
- [ ] Responsável por incidentes e janela de resposta definidos.
- [ ] Credenciais de produção revisadas e rotacionáveis.

## Critérios de beta

- [ ] grupo inicial e responsável por cada conta definidos;
- [ ] consentimento claro de participação no beta;
- [ ] roteiro de testes executado;
- [ ] canal de feedback disponível;
- [ ] severidade dos problemas padronizada;
- [ ] plano de rollback de produção validado;
- [ ] custos de Firebase, Gemini, Vercel e integrações acompanhados.

## Fora do fechamento imediato

Não bloqueiam o beta quando estiverem claramente marcados como indisponíveis ou planejados:

- faturamento automático de planos;
- múltiplos provedores de IA;
- BaaS e carteira financeira real;
- KYC e biometria reais;
- automações irreversíveis pela Kyrubia;
- integrações externas sem homologação do parceiro;
- marketplace amplo de serviços cloud.

## Regra de decisão

Um recurso novo só entra antes do beta quando:

1. corrige risco de segurança, perda de dados ou impossibilidade de sair de um fluxo;
2. completa um fluxo essencial já iniciado;
3. reduz ambiguidade que possa enganar o usuário;
4. possui validação proporcional ao impacto.

Todo o restante vai para o backlog posterior ao beta.
