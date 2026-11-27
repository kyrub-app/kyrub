# CID — Inventário e avaliação inicial de impacto (ROPA/RIPD)
Minuta interna. Inventário inicial derivado das funcionalidades e homologações; não inventário exaustivo nem RIPD aprovado. Confirmar fluxos reais, coleções, Storage, caches, provedores, logs e bases legais antes de ativar. Distinguir titular do CID e titular de dados pessoais (qualquer pessoa identificada/identificável).

| Operação | Dados e pessoas | Finalidade | Base candidata (revisar) | Visibilidade / retenção a decidir |
|---|---|---|---|---|
| Ativação/gestão CID | Identidade, e-mail, identificadores de credencial/passkey, titular | Gestão e proteção | Contrato/segurança conforme operação | Privado; vida da conta e recuperação, descarte |
| Publicação | Nome, foto, apresentação, links, chave Pix opcional | Cartão público escolhido | Contrato para serviço solicitado; consentimento específico quando adequado | Público só por opção; retirar e tratar caches |
| Contatos SOS | Nome, canal, comprovação de autorização, terceiros | Convite e alertas | Avaliar convite inicial separadamente; consentimento do destinatário quando aplicável | Privado; retirar canal, manter prova mínima se justificado |
| Alerta/conversa | Relato, mensagens, participantes; possível saúde ou outros sensíveis | Comunicação auxiliar | Avaliar contrato, proteção da vida/incolumidade e hipóteses art. 11 conforme caso | Apenas participantes autorizados; prazo após encerramento a validar |
| Localização compartilhada | Coordenadas, precisão e horário do emissor | Auxiliar ocorrência | Consentimento específico quando cabível | Privado, opcional, vinculado à ocorrência; não duplicar |
| Último acesso | Tag e horário aproximado | Indicador informativo | Necessidade e base a avaliar | Titular autorizado; último registro sobrescrito; não prova presença |
| Registros legais/segurança | Metadados estritamente necessários, se coletados | Segurança/obrigação | Obrigação legal aplicável ou base validada | Acesso restrito; prazo distinto conforme Marco Civil e finalidade |
| Denúncia/preservação | Relato, protocolo, solicitante e decisões | Análise administrativa | Exercício regular de direitos/obrigação quando cabível; revisar | Restrito; sem retenção automática |
| Direitos | Identidade proporcional, pedido, resposta e protocolo | Atendimento LGPD | Obrigação legal | Restrito; prazo de prova e descarte definido |
| Fornecedores | Dados necessários por integração | Hospedagem, autenticação e entrega | Derivada da finalidade original | Contrato, região, subprocessadores e transferência a confirmar |

## Riscos prioritários
| Risco | Controle existente em candidato ou proposta | Evidência necessária / risco residual |
|---|---|---|
| Exposição de dados de terceiros no CID | Publicação explícita, consentimento separado, minimização | Teste de campos, mídia, caches e revogação; cópias por terceiros não controláveis |
| Perseguição/abuso por localização | Opcional, sem IP exibido, não inferir posição da Tag | Teste de recusa, escopo e exclusão; coordenadas compartilhadas continuam sensíveis ao contexto |
| Falso SOS, coerção ou spam | Confirmação, limites, chat autenticado, denúncia | Testar quotas, abuso, autorização de canais, falha de entrega e suporte; não bloquear ajuda imediata |
| Vazamento de saúde, chat e segredos | Privacidade por padrão, autorização por papel, logs mínimos | Testes negativos servidor/Storage/backup e revisão art. 11; evitar indexar texto livre |
| Acesso administrativo excessivo | Concessões, auditoria, triagem e parecer isolados | MFA real, revisão humana e escopo; rascunho #1385 não homologado; nenhuma divulgação ativa |
| Exclusão incompleta ou ressurreição em backup | Política de descarte proposta, índices mínimos | Teste de restauração e expiração, retenção legal segregada |
| Convites a não usuários e menores | Autorização por canal, elegibilidade progressiva proposta | Verificar base do primeiro contato, proteger terceiros e aferição de idade; revisão jurídica |
| Dependência de prestadores | Fornecedores reais a inventariar | Verificar contrato, região, retenção, incidentes e transferência internacional |
| Fraude e recuperação indevida | Passkey, recuperação e bloqueio propostos | Testes de tomada de controle, troca/revogação e acesso sem conta |

## Decisões e lacunas
Antes de ativar funcionalidades de risco: confirmar necessidade e alternativas menos intrusivas, base legal por finalidade, prazos e responsáveis, avaliação de risco residual, aprovação humana, incident response, canal de direitos e verificação de fornecedores. Não ativar recurso com risco residual não aceito. Reavaliar quando mudar o tratamento, infraestrutura, público, finalidade ou risco. Não presumir que LGPD exige RIPD universal; ANPD pode exigir e recomenda elaboração diante de alto risco. Não há certificação de conformidade. A PR #1385 fica separada, sem tentar contornar o bloqueio de testes.
