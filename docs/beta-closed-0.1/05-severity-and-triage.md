# Severidade e triagem

## P0 — bloqueador

Exemplos:

- exposição ou mistura de dados entre usuários;
- acesso sem autorização;
- perda ou duplicação irreversível;
- aplicativo inacessível para todo o grupo;
- cobrança, pagamento ou movimentação financeira inesperada;
- documento sensível coletado por fluxo não autorizado.

Ação:

1. interromper o fluxo ou o beta;
2. preservar evidências sem dados sensíveis;
3. avaliar rollback;
4. comunicar os participantes afetados;
5. corrigir em branch separada;
6. adicionar teste que reproduza a causa;
7. retomar somente após validação explícita.

## P1 — crítico

Exemplos:

- login falha para parte relevante do grupo;
- fluxo essencial não pode ser concluído;
- pedido, produto, nota ou conexão fica inconsistente;
- usuário fica preso sem saída segura;
- falha recorrente sem contorno aceitável.

Ação:

- não ampliar o beta;
- designar responsável no mesmo ciclo;
- corrigir ou registrar decisão explícita antes da próxima rodada.

## P2 — relevante

Exemplos:

- fluxo funciona com confusão ou etapas desnecessárias;
- mensagem de erro não orienta;
- comportamento falha em navegador ou dispositivo específico;
- sincronização demora, mas se recupera;
- existe contorno seguro.

Ação:

- priorizar conforme frequência e impacto;
- incluir na rodada seguinte quando não bloquear a atual.

## P3 — acabamento

Exemplos:

- texto, espaçamento, alinhamento ou ícone;
- pequena inconsistência visual;
- melhoria de conveniência;
- sugestão sem falha funcional.

Ação:

- agrupar por área;
- corrigir sem desviar do encerramento de P0 e P1.

## Fluxo de triagem

1. confirmar que o relato não contém segredo ou dado excessivo;
2. tentar reproduzir com conta controlada;
3. classificar severidade pelo impacto, não pela preferência;
4. vincular commit, ambiente e dispositivo;
5. definir responsável e próximo passo;
6. comunicar recebimento ao participante;
7. após correção, repetir os passos originais;
8. executar teste de regressão do fluxo vizinho;
9. registrar a versão em que foi resolvido.

## Ritmo recomendado

- P0: avaliação imediata;
- P1: revisão diária durante a rodada;
- P2: revisão duas vezes por semana;
- P3: consolidação no encerramento da rodada.

## Critério para ampliar o grupo

Somente ampliar quando:

- não houver P0 aberto;
- P1 essenciais estiverem corrigidos ou formalmente retirados do escopo;
- o suporte conseguir responder aos problemas recorrentes;
- custos e falhas estiverem observáveis;
- os fluxos principais forem concluídos por participantes externos.
