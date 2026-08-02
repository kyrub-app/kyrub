# Checklist de publicação do beta

## Identidade e acesso

- [ ] domínio do beta definido;
- [ ] Google Login autorizado para o domínio;
- [ ] conta comum de teste criada;
- [ ] conta administrativa controlada e separada;
- [ ] login, logout e retorno após recarregar validados;
- [ ] acesso administrativo negado para conta comum.

## Ambientes

- [ ] variáveis de Preview revisadas;
- [ ] variáveis de Production revisadas;
- [ ] nenhum segredo exposto em variável `VITE_`;
- [ ] Firebase, Gemini e integrações usam credenciais adequadas ao ambiente;
- [ ] `/api/health` responde sem expor segredos;
- [ ] release identificável pelo commit.

## Dados e segurança

- [ ] regras do Firestore publicadas na ordem correta;
- [ ] índices necessários publicados;
- [ ] dados de teste separados dos dados reais;
- [ ] nenhuma tela pede documento real em fluxo demonstrativo;
- [ ] recursos de KYC, biometria, carteira e nota fiscal estão ocultos ou marcados como indisponíveis;
- [ ] logs revisados para não registrar tokens ou dados pessoais completos;
- [ ] plano de rollback disponível.

## Experiência essencial

- [ ] celular Android validado;
- [ ] iPhone/Safari validado;
- [ ] desktop validado;
- [ ] rolagem de telas e modais longos validada;
- [ ] teclado móvel não cobre ações essenciais;
- [ ] conexão lenta ou interrompida possui mensagem e recuperação;
- [ ] estados vazio, carregando, sucesso e erro são compreensíveis;
- [ ] nenhum valor fictício é apresentado como métrica real.

## Conteúdo e suporte

- [ ] aviso de beta visível;
- [ ] canal de suporte informado;
- [ ] contato de privacidade informado;
- [ ] Termos e Política de Privacidade disponíveis ou fluxo de convite limitado aprovado;
- [ ] regras de convivência e denúncia comunicadas;
- [ ] respostas-padrão de suporte preparadas.

## Participantes

- [ ] 5 a 15 participantes selecionados;
- [ ] perfil de uso de cada participante registrado sem dados excessivos;
- [ ] responsável pelo acompanhamento definido;
- [ ] roteiro enviado;
- [ ] ciência de participação recebida;
- [ ] canal de feedback testado.

## Aprovação final

- [ ] PRs destinados à rodada revisados visualmente;
- [ ] checks do GitHub verdes;
- [ ] regras e migrações necessárias prontas;
- [ ] P0 e P1 conhecidos tratados;
- [ ] data e janela de observação definidas;
- [ ] decisão explícita de iniciar registrada.
