# Plano de beta fechado

## Objetivo

Validar o Kyrub com um grupo pequeno, identificável e acompanhado antes de qualquer divulgação ampla.

## Tamanho inicial

Começar com 5 a 15 pessoas, incluindo:

- usuário sem loja;
- profissional autônomo;
- lojista com poucos produtos;
- pessoa usando dois dispositivos;
- usuário convidado para nota ou conexão;
- administrador autorizado.

Não ampliar o grupo enquanto houver problema crítico sem solução ou recuperação.

## Matriz de dispositivos

Executar ao menos em:

- Android recente, Chrome;
- iPhone recente, Safari;
- Windows, Chrome ou Edge;
- conexão Wi-Fi estável;
- conexão móvel lenta ou intermitente.

## Roteiro principal

### Conta e perfil

1. entrar com Google;
2. confirmar nome, e-mail e foto;
3. editar nome e visibilidade;
4. sair e entrar novamente;
5. confirmar dados em outro dispositivo.

### Loja e produtos

1. abrir a loja vazia;
2. completar os dados da loja;
3. criar até cinco produtos no plano gratuito;
4. editar estoque, mídia e preço;
5. abrir a vitrine pública;
6. confirmar que nenhum dado de outra loja aparece.

### Pedidos e operação

1. criar pedido de teste pelos fluxos permitidos;
2. alterar status;
3. verificar consumo e reconciliação de estoque;
4. validar estados vazios e falhas de conexão;
5. confirmar que operações não duplicam após recarregar.

### Social

1. encontrar outro usuário real;
2. enviar e aceitar conexão;
3. abrir conversa privada;
4. enviar mensagens dos dois lados;
5. validar histórico em outro dispositivo;
6. testar perfil oculto e ausência de autorização.

### Notas e produtividade

1. criar nota manual;
2. adicionar checklist;
3. convidar colaborador;
4. editar e conferir histórico;
5. agendar lembrete;
6. publicar somente mediante intenção explícita;
7. testar rolagem em conteúdo extenso.

### Kyrubia

1. fazer pergunta simples sem ação;
2. pedir uma nota completa;
3. revisar e cancelar;
4. repetir e confirmar;
5. aceitar a lente de oportunidades;
6. confirmar que a nota não é repetida em loop;
7. testar mensagem de cota, rede e indisponibilidade;
8. confirmar que sempre existe saída do chat.

### Administração

1. entrar com conta comum e confirmar acesso negado;
2. entrar com administrador ativo;
3. validar métricas reais ou indisponíveis;
4. buscar usuário e loja;
5. confirmar restrições por papel;
6. verificar registro da sessão administrativa.

## Testes de resiliência

- desligar a rede durante edição;
- recarregar a página durante uma ação não confirmada;
- abrir o Kyrub em duas abas;
- usar dois dispositivos na mesma conta;
- expirar a sessão;
- simular indisponibilidade da Kyrubia;
- enviar conteúdo muito longo;
- tentar repetir rapidamente uma ação;
- voltar e avançar pelo navegador.

## Registro de problemas

Cada problema deve conter:

- ambiente e dispositivo;
- conta/papel sem expor dados pessoais;
- passos exatos;
- resultado esperado;
- resultado observado;
- captura ou vídeo sem segredos;
- frequência;
- severidade.

## Severidade

- **P0 — bloqueador:** perda/exposição de dados, autorização indevida, cobrança errada ou aplicação inacessível.
- **P1 — crítico:** fluxo essencial impossível sem alternativa segura.
- **P2 — relevante:** fluxo funciona com erro, confusão ou contorno.
- **P3 — acabamento:** texto, alinhamento, responsividade ou conveniência.

O beta não amplia com P0 aberto. P1 exige decisão explícita e plano de correção.

## Critério de saída

O beta inicial termina quando:

- nenhum P0 estiver aberto;
- P1 essenciais estiverem corrigidos;
- os fluxos principais tiverem sido concluídos por usuários externos;
- custos e falhas estiverem visíveis;
- termos, privacidade e exclusão de conta estiverem aprovados para a próxima etapa;
- existir plano de suporte e rollback.
