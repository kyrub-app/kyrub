# Kyrub — Revisão de privacidade por alteração (proposta V1)

Complementa KYRUB_PRIVACY_GOVERNANCE_V1.md e o processo de governança existente. Aplicar a alterações de dados pessoais, finalidade, visibilidade, integrações, armazenamento, autenticação ou compartilhamento. Não é certificação LGPD nem autorização automática de publicação.

## Registro para cada PR relevante
- [ ] Capacidade afetada e estado: inativa, homologação ou candidata a produção.
- [ ] Inventário: categorias de dados, titulares, finalidade, necessidade e fluxo atualizado.
- [ ] Base legal candidata identificada e revisão humana quando necessária; dados sensíveis analisados separadamente.
- [ ] Visibilidade privada por padrão e escolha informada para exposição opcional.
- [ ] Acesso por servidor, titularidade, isolamento entre tenants e revogação.
- [ ] Destinatários/fornecedores, região, transferências e contratos revisados conforme alteração.
- [ ] Retenção, descarte, exceções legais, índices, cache e backups definidos.
- [ ] Direitos do titular e canal de atendimento acessíveis, inclusive sem conta quando aplicável.
- [ ] Avisos e consentimentos específicos/versionados quando pertinentes; retirada efetiva.
- [ ] Impacto e risco residual avaliados; revisão do RIPD quando pertinente.
- [ ] Testes negativos, sem dados reais em evidências; registrar comandos e resultados.
- [ ] Resposta a incidentes e responsabilidade operacional verificadas.
- [ ] Decisão de lançamento por capacidade: manter inativa se requisito material não comprovado.

## Evidências
Referência ao ROPA, versão dos documentos, testes/commit, responsável, data e justificativa para itens não aplicáveis. Revisão jurídica humana não pode ser substituída por resultado automatizado. Não tratar ausência de mudança detectada como prova de conformidade.

## Central de privacidade — limites da primeira fundação
Contrato comum e formulário isolado com categorias de direitos e contexto. Recebimento simulado exige referência de canal previamente verificado por fonte confiável; a política pura não verifica canal, persiste solicitações ou autentica titular. Protocolo não é autorização de consulta ou exclusão. A UI só aceita recibo simulado do adaptador e fica indisponível sem ele. Antes de oferecer canal real: definir contato público funcional e responsável, autenticação proporcional, prova de entrega, persistência idempotente, controles de abuso, acesso seguro, atendimento e prazos aplicáveis, segregação administrativa, testes de isolamento e fluxo sem conta. Não usar a fila SOS para solicitações de direitos. Não substituir canal manual funcional por uma demonstração.
