# Kyrub — Gestão do ciclo de vida dos dados V1
Minuta interna para revisão jurídica e operacional. Não aprova prazos legais, não autoriza exclusão, não habilita TTL/cron e não altera produção. Complementa PRIVACY_SECURITY_READINESS.md, KYRUB_PRIVACY_GOVERNANCE_V1.md e KYRUB_CID_ROPA_RIPD_DRAFT_V1.md. Preserva o planejador FinOps mensal existente (docs/finance/platform-finops-monthly-retention-policy-v1.md). Não incorpora nem avança o rascunho #1385.

## Registro obrigatório por tratamento
Identificar finalidade, base legal revisada, responsável, controlador/operador, categorias de titulares, fonte, cópias, evento inicial/final, prazo justificado, hipótese de conservação, procedimento de anonimização ou descarte, dependências e teste de restauração. Revisar também subcoleções, índices, Storage, caches e prestadores. Expiração de acesso não equivale a exclusão de dados. Ocultar não equivale a eliminar. Pseudonimização/hash não equivale necessariamente a anonimização.

## Matriz inicial (não exaustiva)
| Categoria | Evento para revisão | Diretriz candidata / pendência |
|---|---|---|
| Conta, perfil e preferências | Encerramento ou correção | Remover exposição pública e avaliar dados privados, vínculos e obrigações; sem prazo definitivo |
| Publicações e encaminhamentos | Expiração da visibilidade ou exclusão solicitada | Janela de 24h da Taba é visibilidade, não descarte da publicação original; revisar origem, mídia e referências |
| Conexões, mensagens e notas compartilhadas | Encerramento do vínculo ou solicitação | Proteger direitos de outros participantes; não apagar globalmente sem análise |
| Lojas, equipe, pedidos, financeiro e estoque | Encerramento de relação/operação | Identificar controlador e obrigações fiscais, comerciais e trabalhistas por tipo de registro; não definir prazo universal |
| Mídia e arquivos | Desvinculação de todas as referências | Verificar referências, cópias, acesso e recuperação; evitar excluir objeto compartilhado |
| Credenciais de integração e autenticação | Revogação, expiração ou encerramento | Invalidar acesso; revisar ciclo de armazenamento com responsável de segurança; sem alteração nesta PR |
| CID e SOS | Retirada de publicação, revogação ou encerramento da ocorrência | Avaliação jurídica específica já prevista no RIPD; não definir nem implementar retenção de evidências ou registros de acesso nesta PR |
| Direitos e consentimentos | Conclusão do pedido ou revogação | Manter prova mínima quando justificada; distinguir credencial temporária, protocolo e registro jurídico |
| Marcadores MAU | Encerramento do mês | Preservar proposta de mês de atividade + três meses civis posteriores; revisão exige fence, agregado, reconciliação e governança do planejador existente |
| Backups e caches | Fim do prazo aprovado ou invalidação | Inventariar ciclos, testar restauração sem reintroduzir dados removidos indevidamente |
| Kyrubia | Antes de reativação | Fora do lançamento V1; revisar finalidade, minimização e descarte antes de qualquer ativação |
| Fornecedores | Encerramento da finalidade/contrato | Confirmar retenção, subprocessadores, devolução e eliminação contratual |

## Fluxo operacional proposto
1. Inventariar e aprovar a política por categoria. Nenhuma idade de registro isoladamente determina eliminação.
2. Avaliar finalidade, dependências, direitos em andamento e obrigações aplicáveis com equipe responsável. Pendência exige resolução e nova revisão, não retenção indefinida.
3. Planejar operação e validar cobertura de cópias, referências, índices e restauração.
4. Produzir relatório de simulação com contagens, motivos e estimativas claramente qualificadas; não incluir conteúdo pessoal. Revisão humana antes de qualquer operação real.
5. Implementações posteriores exigem homologação própria, revalidação de condições, controles de concorrência e recuperação e autorização explícita de produção. Não há executor nesta etapa.

## Economia operacional
Mensurar quantidade e volume por categoria, custo de consulta, exclusão e armazenamento, e impacto de backup. Não prometer redução faturada. Evitar manter cópias redundantes, mas preservar integridade comercial e obrigações aplicáveis.

## Limites da homologação
A única regra nova executável é um classificador puro para registros sintéticos de preferências temporárias, sem conexão com banco, sem identificadores pessoais e sem autorização de descarte. Janela de 7 dias é exemplo exclusivo de teste, não política do Kyrub. Não usar este classificador para registros legais, evidências, logs, pedidos, contas ou dados reais. A matriz não substitui inventário por coleção, revisão de bases legais, prazos, contratos, validação de backups ou canal efetivo de direitos.
