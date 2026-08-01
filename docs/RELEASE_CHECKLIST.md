# Checklist de release

## Antes de abrir o PR

- [ ] escopo pequeno e descrito;
- [ ] nenhuma credencial ou dado pessoal incluído;
- [ ] modo manual preservado;
- [ ] estados de loading, vazio, sucesso e erro tratados;
- [ ] ações críticas exigem confirmação;
- [ ] novas coleções possuem regras e testes;
- [ ] integrações continuam desabilitadas fora do ambiente autorizado.

## Validação local

```bash
npm run mvp:check
npm run lint
npm run prebuild
npm run build
```

Quando a alteração tocar Firestore, execute também:

```bash
npm run test:rules
```

Quando tocar pedidos, estoque, integrações ou operação:

```bash
npm run test:operational
npm run operations:check
```

## Revisão funcional

- [ ] login e logout;
- [ ] retorno após recarregar;
- [ ] celular e desktop;
- [ ] navegação de voltar/fechar;
- [ ] rolagem em conteúdo longo;
- [ ] teclado móvel;
- [ ] conexão lenta ou ausente;
- [ ] mensagem legível para falha externa;
- [ ] dados de outro usuário não aparecem;
- [ ] nenhum valor fictício é apresentado como métrica real.

## Preview

- [ ] variáveis de Preview configuradas;
- [ ] `/api/health` responde sem segredos;
- [ ] `/api/kyrubia` informa configuração esperada;
- [ ] logs não contêm tokens, documentos ou payload pessoal;
- [ ] OAuth aceita o domínio de Preview quando necessário;
- [ ] migração ou índice foi testado antes de produção.

## Promoção para produção

- [ ] PR aprovado e checks verdes;
- [ ] risco e plano de rollback registrados;
- [ ] responsável pela observação pós-release definido;
- [ ] variáveis de Production revisadas;
- [ ] regras e índices publicados na ordem correta;
- [ ] release identificável por commit;
- [ ] nenhuma mudança destrutiva depende apenas do navegador.

## Verificação após produção

1. abrir `/api/health`;
2. autenticar com conta de teste controlada;
3. executar o fluxo alterado;
4. verificar logs e latência;
5. testar saída e recuperação;
6. confirmar que o fluxo anterior continua funcionando;
7. registrar o resultado no PR ou release.

## Rollback

Executar rollback quando houver:

- exposição ou mistura de dados;
- autorização incorreta;
- perda ou duplicação irreversível;
- falha ampla de login;
- aplicação sem navegação de saída;
- custo descontrolado;
- erro que impeça o fluxo principal sem contorno seguro.

Após rollback:

1. confirmar restauração;
2. preservar logs e evidências sem dados sensíveis;
3. abrir incidente;
4. corrigir em branch nova;
5. adicionar teste que reproduza a causa.
