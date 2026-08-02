# Checklist pós-deploy

## Identificação

- ambiente:
- domínio:
- commit:
- horário do deploy:
- responsável pela observação:
- janela de acompanhamento:

## Saúde inicial

- [ ] `/api/health` responde;
- [ ] release informada corresponde ao commit;
- [ ] página inicial carrega sem erro fatal;
- [ ] recursos indisponíveis estão corretamente identificados;
- [ ] logs não apresentam tokens ou dados pessoais completos;
- [ ] custos e cotas dos fornecedores estão acessíveis para acompanhamento.

## Teste de fumaça

- [ ] login com conta comum;
- [ ] logout;
- [ ] recarregamento mantém estado esperado;
- [ ] perfil abre e pode ser fechado;
- [ ] uma nota de teste pode ser criada e removida ou arquivada;
- [ ] loja controlada abre;
- [ ] item de teste pode ser criado ou editado;
- [ ] vitrine correspondente abre;
- [ ] conexão entre duas contas controladas funciona;
- [ ] conta comum não acessa administração;
- [ ] conta administrativa autorizada acessa somente o permitido.

## Verificação dos PRs da rodada

Para cada PR incluído:

- [ ] fluxo alterado executado;
- [ ] comportamento anterior essencial preservado;
- [ ] celular validado;
- [ ] desktop validado;
- [ ] falha de rede possui saída;
- [ ] resultado registrado no PR.

## Firestore e integrações

- [ ] regras publicadas correspondem à versão esperada;
- [ ] índices não estão pendentes;
- [ ] leituras e escritas ocorrem somente nos caminhos previstos;
- [ ] Kyrubia responde ou informa indisponibilidade com segurança;
- [ ] integrações não homologadas permanecem desativadas;
- [ ] nenhum fluxo financeiro real está acessível.

## Observação inicial

Durante a janela definida, acompanhar:

- erros fatais do cliente;
- falhas de autenticação;
- negações inesperadas do Firestore;
- repetição ou duplicação de ações;
- aumento anormal de leituras, chamadas de IA ou custos;
- relatos de dados incorretos;
- lentidão ampla;
- falhas por dispositivo ou navegador.

## Decisão

- [ ] manter o beta disponível;
- [ ] limitar novos convites;
- [ ] desabilitar um recurso;
- [ ] executar rollback;
- [ ] encerrar temporariamente a rodada.

Motivo e responsável pela decisão:

`[REGISTRO]`
