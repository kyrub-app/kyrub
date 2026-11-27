# Kyrub — Resposta a incidentes de privacidade V1
Minuta interna, não publicada, sem aprovação jurídica ou designação de responsáveis. Complementa docs/INCIDENT_RUNBOOK.md, preservando SEV-0 a SEV-3 e procedimentos operacionais existentes. Não constitui comunicação real, autorização de mudança de produção ou automação de acesso a evidências. Não altera PR #1385.

## Primeira resposta
- Acionar responsável técnico, privacidade e responsável pela operação afetada; identificar controlador por finalidade (Kyrub ou lojista, conforme o caso). Operador informa prontamente seu controlador, sem pressupor que pode comunicar em nome dele.
- Aplicar runbook operacional, preservar continuidade e minimizar exposição; qualquer ação de produção segue autorização e procedimentos vigentes.
- Registrar detecção, ambiente, serviços, escopo e momento em que controlador soube que dados pessoais foram afetados. Não confundir detecção, confirmação, contenção e comunicação. Não reiniciar o relógio após reclassificação.
- Manter registro restrito; não incluir dados pessoais brutos, segredos ou credenciais em tickets comuns, CI, chats ou alertas. Evidências técnicas ficam fora da implementação desta PR.

## Avaliação
Se houver dúvida, investigar urgentemente. Avaliar propriedades de confidencialidade, integridade, disponibilidade e autenticidade. Separar SEV operacional da análise de risco/dano aos titulares.
A Resolução CD/ANPD 15/2024, art. 5º, combina impacto potencial significativo aos direitos/interesses fundamentais com pelo menos um fator: sensibilidade; crianças, adolescentes ou idosos; dados financeiros; autenticação; sigilo legal/judicial/profissional; larga escala. Avaliar contexto, extensão e impactos concretos. Não usar contagem fixa para larga escala. Resultado automatizado é apenas apoio à revisão humana, não dispensa comunicação nem conclui ausência de risco.
A decisão, justificativa, responsáveis e revisão de fatos novos devem ser registrados. Na dúvida material, escalar sem aguardar investigação completa.

## Comunicação e calendário
Padrão conservador: 3 dias úteis para ANPD e titulares quando cabível, desde conhecimento pelo controlador de que dados pessoais foram afetados; 20 dias úteis desde comunicação preliminar à ANPD para complementação justificada; declaração sobre comunicação aos titulares em até 3 dias úteis após término do prazo do art. 9º caput. Não presumir tratamento diferenciado de pequeno porte ou inexistência de regra específica.
Caso comunicação individual seja inviável ou titulares não identificáveis, avaliar divulgação ampla nos termos do art. 9º §3º, inclusive permanência mínima de três meses. Comunicação ao titular clara e acionável, descrevendo categorias, riscos, mitigação, ciência, contato e demais elementos aplicáveis. Não expor dados de outras pessoas.
Representante/encarregado autorizado deve verificar formulário e documentos de representação na página oficial da ANPD, protocolar e registrar comprovantes por destinatário. Comunicação preliminar não encerra obrigação de complementar.
Registrar vencimentos verificados por responsável com calendário aplicável, feriados e regras específicas. Controle interno proposto: avaliação imediata e alerta antes do vencimento. Nenhum cálculo jurídico automático nesta PR; não substituir calendário confirmado por contagem simples de dias de semana.

## Registro e encerramento
Conforme art. 10, manter registro de incidentes de segurança com dados pessoais, mesmo não comunicados, por pelo menos cinco anos da data do registro, ressalvadas hipóteses aplicáveis e obrigações adicionais. Registro administrativo mínimo separado de conteúdo bruto e evidência técnica; não aplicar esse prazo indiscriminadamente a todos os logs ou cópias.
Incluir ciência, circunstâncias, categorias, número de titulares, avaliação, medidas, comunicação (ou justificativa de ausência). Encerramento exige validação da recuperação, medidas corretivas, acompanhamento das comunicações, responsável por ações preventivas e revisão pós-incidente. Reabrir quando houver fatos novos.
Para futuro Control Plane: quadro de incidentes, classificação operacional e de privacidade separadas, responsáveis, prazos verificados, pendências, histórico e indicadores agregados. Sem dados brutos na lista, sem envio automático e sem acesso irrestrito de administradores.

## Exercício de mesa
Simular incidente financeiro fictício, indisponibilidade sem dados pessoais, impacto ainda desconhecido e incidente de prestador. Registrar triagem, ciência, responsáveis, decisão, prazos manuais, rascunho de comunicação, validação de recuperação e ações preventivas. Não utilizar clientes reais, não enviar mensagens nem protocolos à ANPD. Critério de aprovação operacional: responsável designado, canais testados, calendário confirmado, exercício completo com evidências e revisão jurídica. Classificador puro desta PR só usa flags e data fictícia, sem persistência, UI ou calendário.

## Fontes oficiais verificadas
- LGPD, art. 48: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- Resolução CD/ANPD nº 15/2024, arts. 3–10: https://bibliotecadigital.mj.gov.br/bitstream/1/12879/2/RES_ANPD_2024_15.html
- Orientações e canal ANPD: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis

Pendências: confirmar controlador/representantes e contatos, regime jurídico, calendário, procedimentos de prestadores, revisão operacional, exercício de mesa real em homologação e integração administrativa. Nenhum incidente real identificado ou comunicado por esta PR.
