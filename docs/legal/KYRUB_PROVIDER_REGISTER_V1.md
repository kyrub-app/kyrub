# Kyrub — Registro de fornecedores e terceiros V1
Revisão inicial: 26/11/2026 (America/Sao_Paulo). Minuta interna, não publicada. Base: código e documentos da cadeia #1397 corrigida em 5b16a63e72417fb42262c61799eb81d75ca5319e, documentação pública dos fornecedores consultada nesta revisão. Não é verificação de contratos assinados, de configurações de produção ou parecer jurídico. Não contratar, alterar configurações, consultar segredos ou transferir dados. A ausência de comprovação não significa descumprimento; significa pendência de verificação.

## Inventário por operação
| Serviço / terceiro | Situação conhecida e evidência | Dados potencialmente tratados e finalidade | Papel candidato (por operação) | Lacunas |
|---|---|---|---|---|
| Firebase Authentication / Google Cloud | Infraestrutura principal; SDKs firebase e firebase-admin em package.json | Identificadores, e-mail, credenciais protegidas, metadados de autenticação; ingresso e segurança | Prestador de infraestrutura; qualificar por serviço/termos; dados próprios do fornecedor podem ter papel distinto | Projeto/plano, produtos efetivamente habilitados, termos aplicáveis, região por serviço, acessos, exclusão, incidentes |
| Cloud Firestore | Infraestrutura de persistência; firebase-admin, regras e testes no repositório | Perfil, social, ERP, direitos, demais dados conforme funcionalidade ativa; persistência e isolamento | Operador candidato para dados do cliente, sujeito aos termos aplicáveis | Localização efetiva, IAM, backups, subcoleções, inventário e prazos |
| Cloud Storage / Firebase | Mídia prevista no checklist e rotas store-media em vercel.json; confirmar buckets/configuração efetiva | Fotos, arquivos e mídias; armazenamento e entrega | Operador candidato | Buckets, região, URLs/caches, regras, cópias, referências e descarte |
| Google Sign-In | Ingresso pelo Google já previsto na documentação da V1 | UID, perfil básico/e-mail, conforme escopos reais; autenticação | Qualificar separadamente do Firebase e do tratamento próprio do Google | Escopos OAuth efetivos, avisos, dados retornados, retenção e revogação |
| Vercel | Hospedagem/deploy e funções; vercel.json, @vercel/queue e CI | Requisições, metadados técnicos, execução, filas quando habilitadas, builds e logs; entrega do app | Operador candidato para dados de cliente; qualificar outros tratamentos próprios | Plano atual, cobertura do DPA, regiões/edge, logs, filas, subprocessadores, acessos e descarte |
| Mercado Pago | Conta/beneficiário pré-validado conforme docs/finance/mercado-pago-recipient-preflight-production.md; 1:N não aprovado no gate comercial atualizado em 21/11 | Dados estritamente necessários à cobrança, recebedor, transações, conciliação, OAuth protegido | Avaliar controlador independente nas operações reguladas e eventual operador em operações específicas; não presumir único papel | Contrato do produto efetivo, categorias enviadas, escopos, retenções, direitos, condições de repasse e homologação comercial |
| Mercado Livre | Rota de consumidor de fila no vercel.json; integração candidata; ativação por loja e escopos não comprovados aqui | Catálogo, pedidos e identificadores de integração conforme fluxo autorizado | Qualificar por finalidade e operação do lojista | Prova de ativação, termos, escopos, região, revogação e retenção |
| GitHub | Repositório e CI utilizados para desenvolvimento | Código, dados de colaboradores e metadados de build; não utilizar dados pessoais de clientes em fixtures | Qualificar tratamento de conta e infraestrutura de desenvolvimento | Acessos, contratos, logs/artifacts, segregação, revisão de conteúdo e segredos |
| Google GenAI / Gemini | Dependência @google/genai existente; Kyrubia fora deste ciclo comercial | Nenhum novo envio autorizado; avaliar dados/uso futuro separadamente | A determinar se ativado | Produto/plano, termos, retenção, treinamento, região, base e avaliação de impacto |
| E-mail/SMS/WhatsApp de SOS, aferição de idade, LoRa, serviços fiscais, mídia externa, monitoramento | Planejados ou candidatos; não confirmar fornecedor, contrato ou ativação pela presença de código | Mapear somente quando houver capacidade e integração reais | A determinar por operação | Seleção e avaliação, custo e aprovação explícita antes de contratar ou ativar |

Lojistas, empregadores, entregadores e comunidades não são automaticamente subprocessadores do Kyrub. Classificar papéis por finalidade, autonomia e instruções contratuais. ERP pode envolver dados tratados por lojista como controlador; não confundir com dados da conta Kyrub. Preservar o gate 1:N; não inferir habilitação de Pix ou repasses a partir de OAuth. Não usar dados SOS, saúde ou localização para publicidade. Não ativar IA, envios externos ou nova integração nesta revisão.

## Documentação pública consultada e verificações pendentes
- Firebase: https://firebase.google.com/support/privacy ; https://firebase.google.com/terms ; https://firebase.google.com/terms/data-processing-terms ; https://firebase.google.com/docs/projects/locations . Alguns produtos permitem escolher localização, outros não; verificar a localização e os termos de cada produto efetivamente utilizado, inclusive distinção entre dados de cliente e dados do serviço.
- Vercel: https://vercel.com/legal/dpa ; https://vercel.com/legal . A página pública do DPA indica aplicação aos planos Pro e Enterprise; confirmar plano/contrato do Kyrub e abrangência. O DPA contempla processamento em outros países; não inferir residência exclusivamente brasileira de uma região de execução.
- Mercado Pago: https://www.mercadopago.com.br/privacidade/declaracao-privacidade ; https://www.mercadopago.com.br/privacidade/resumo . Declaração pública aborda tratamento e retenção de dados financeiros; não substitui contrato do produto específico, nem define por si só todos os papéis do Kyrub e dos lojistas.
- Transferências internacionais: identificar exportador/importador, país/destinatário, operação e mecanismo aplicável; revisão jurídica à luz da LGPD e regulamentação ANPD vigente. Não presumir suficiência de cláusulas estrangeiras ou residência local.
- Para demais serviços, fonte/versão contratual e documentação específica ainda não verificadas.

## Dossiê por fornecedor e operação (preencher sem dados de clientes ou credenciais)
1. Identidade jurídica, produto/plano, situação (planejado, homologação, ativo comprovado, encerrado), responsável interno e referência de evidência.
2. Finalidade, dados estritamente necessários, titulares, origem/destino, papel das partes e base legal revisada.
3. Contrato/termos/DPA aplicáveis: versão, data, escopo, referência restrita, instruções, confidencialidade, assistência a direitos, incidentes, devolução e descarte.
4. Região efetiva por recurso, países, subprocessadores, transferências subsequentes e mecanismo internacional quando aplicável; documentar evidência e decisão jurídica.
5. Acessos, autenticação, criptografia, segregação de ambientes, configuração mínima, retenção de dados/logs/backups, recuperação e eliminação.
6. Incidentes: canal, responsável, prazo de aviso contratual e procedimento coordenado com Kyrub.
7. Saída/portabilidade, revogação de acesso e destinação de cópias; teste ou evidência proporcional.
8. Custo e risco residual, parecer técnico, aprovação jurídica/operacional, data e próxima revisão; pendências com responsável.

## Portões e manutenção
- Nenhum fornecedor novo recebe aprovação por mera existência de SDK, build, conta ou termos públicos. Não preencher campos desconhecidos como confirmados.
- Antes de ativar capacidade nova, revisar dossiê e dependências; impedir ativação até tratar riscos materiais. Para capacidade existente, registrar lacunas, responsável e plano de mitigação; não desligar produção automaticamente.
- Revisar quando houver mudança de contrato, escopo, finalidade, dados, região, subprocessador, incidente, preço relevante ou encerramento. Revisão anual proposta como mínimo interno, não prazo legal.
- Consolidar o registro no futuro Control Plane, inicialmente por documentos versionados; permissões de compliance, referências de evidência e estados de revisão, sem anexar contratos sensíveis publicamente. Sem automação de aprovação.
- Reconciliar a futura Central de Privacidade de consentimentos com as preferências de comunicação já existentes (docs/ROADMAP_INTEGRATION.md #390 e rotas communication-preferences), sem duas fontes de verdade.

## Entregáveis antes da liberação comercial
Validar configuração efetiva (leitura mínima autorizada), contratos e responsáveis; documentar transferência internacional e dossiês das operações ativas; testar direitos/retirada de consentimento nos serviços reais; estabelecer comunicação de incidente, prazos e contatos; revisão humana. Este documento é o inventário inicial, não prova de conformidade, contratação ou habilitação.
