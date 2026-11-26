# Kyrub Tag — CID (Cartão de Informação Digital)
Decisões de produto de 26/11/2026. Implementação progressiva; este documento não autoriza alterações em produção.

## Endereços
- Perfil futuro: https://kyrub.com/seu-perfil, sem @. Reservar rotas de sistema e preservar links /kairubido/ durante migração.
- Loja: https://kyrub.com/@sua-loja.
- Comunidade futura: https://comunidade.kyrub.com/sua-comunidade.
- Central de dispositivos futura: https://tag.kyrub.com.
- CID futuro: https://tag.kyrub.com/cid/identificador.
- Catálogo de modelos: /adesivo/promocional, /chaveiro/couro, /chaveiro/lora, /pulseira/nfc. Categorias não são identificadores individuais.
- Preservar endereço NFC existente https://kyrub.com/tag/identificador; sem regravação, com compatibilidade permanente. PR #1348 altera somente exemplo visual de perfil; rota funcional ainda /kairubido/ e comunidade /comunidade/.

## Identidade e ações
CID é o cartão, Kyrub Tag é a família de dispositivos. Futuramente múltiplos dispositivos podem apontar para CID mediante vínculo autorizado, sem transferência de titularidade física, duplicação de benefícios ou presunção de posse pela URL. CID autônomo não exige conta Kyrub completa.
- Titular autenticado: Editar e SOS.
- Visitante: Compartilhar e SOS. Compartilhar endereço público, com Web Share API e alternativa de copiar link; não incluir conteúdo privado.
- Manter mecanismo acessível de autenticação do titular e recuperação, inclusive em passkey; nunca presumir titularidade por leitura NFC ou estado local.

## Pix direto
Opcional e gratuito; pagamentos diretamente à conta indicada, sem intermediação Kyrub ou Mercado Pago. Pagador escolhe valor.
- Campos: habilitar, tipo/chave, nome e cidade do recebedor; recomendar chave aleatória. Consentimento explícito de divulgação; QR também contém a chave. Não exigir CPF.
- Ação principal: Copiar chave Pix, independente de QR e banco específico. Ações complementares: Exibir QR Code e Pix Copia e Cola; geração local, cópia manual quando necessário. Não condicionar o lançamento a pagamento bancário real. QR estático e Pix Copia e Cola equivalentes, conforme especificação vigente do Banco Central, com validação e testes de payload. Não afirmar verificação bancária da titularidade ou confirmação de pagamento. Orientar pagador a verificar beneficiário no banco.
- Proteger alterações por autenticação recente do titular, auditoria sem registrar chave em logs e notificação quando disponível. Não publicar rascunho sem consentimento. Bloqueio do cartão impede acesso público.

## SOS e ocorrências — decisões ampliadas
- Preservar os botões 190, 192, 193. Abrir SOS não dispara mensagens. Botão "Emitir alerta" abre formulário com motivo obrigatório, exemplo "Tag encontrada; animal encontrado; emergência acionada.", localização opcional e SMS opcional. Confirmação explícita antes de enviar.
- Até três contatos de emergência, cadastrados pelo titular, com nome e canais verificados e consentidos; WhatsApp e e-mail como canais automáticos quando habilitados e disponíveis; SMS adicional por escolha do emissor, sem autorização implícita de cobrança. Cópia obrigatória planejada ao titular pelos canais habilitados, inclusive SMS se selecionado e disponível; avisos internos quando conta vinculada. Não prometer entrega: mostrar estados por canal e destinatário. Falha em um canal não cancela demais canais. WhatsApp Business depende de integração, modelos, políticas e custos; nenhuma dependência exclusiva da Meta.
- Texto visível antes da confirmação e no primeiro acesso ao chat: "As informações desta ocorrência, incluindo mensagens e registros técnicos de acesso, poderão ser preservadas e fornecidas às autoridades competentes, conforme a legislação aplicável. O uso indevido desta funcionalidade poderá resultar em responsabilização legal." Sem caixa adicional de confirmação, sem alegar rastreamento garantido. Link para aviso de privacidade. Avisos de perigo imediato não substituem serviços públicos.
- Limites por dispositivo, origem, destinatário, conta/sessão e orçamento global; idempotência, outbox, antifraude, proteção contra abuso distribuído, sem impedir acesso aos telefones públicos. Limites do piloto (5 min e 3 alertas/24h) propostos na PR #1353, não definitivos; não descartar alertas legítimos por classificação de conteúdo. Número do titular privado.
- Chat temporário por ocorrência, dentro do Kyrub, com até cinco participantes: emissor, titular e três contatos. Acesso sem conta completa por sessão do emissor e convites individuais, temporários, revogáveis e vinculados aos destinatários; autenticação do titular. Não revelar telefones ou e-mails privados; não transmitir tokens em registros ou exportações. Mensagem inicial determinística: "Alerta recebido. Por favor, explique a situação." Notificação com link protegido; registrar entrega real separadamente de tentativa.
- Titular pode informar "Estou bem / acionamento indevido", confirmar recuperação de objeto ou animal, encerrar ocorrência/chat. Atualizar participantes e contatos efetivamente notificados nos canais habilitados. Histórico privado, revogação de acesso e retenção conforme necessidade e legislação.
- Habilidade determinística de classificação e coleta de contexto (objeto/pet encontrado, acidente, mal-estar, teste, indefinido), sem LLM; preparação independente para futura Kyrubia, que permanece fora do lançamento. Sinalizar privadamente possíveis exigências financeiras condicionadas à devolução, diferenciar recompensa voluntária, não atribuir crime automaticamente; orientar devolução em local público/seguro, preservação e autoridades. Não atrasar alerta confirmado nem bloquear por interpretação de texto. Não acionar serviços de emergência automaticamente.
- Categoria Pet proposta: CID do animal, foto, nome, orientações de manejo e necessidades especiais escolhidas pelo titular; dados particulares do tutor protegidos. Rota futura /pet/identificador; não alterar endereço NFC permanente.
- Homologar com provedores simulados e dados fictícios, sem envio real. Contratação, custo por mensagem, orçamento e ativação dependem de autorização. Verificar consentimento e revogação dos contatos, prova de titularidade dos canais e retenção antes de ativar.

## Central do Titular
Acesso por "Acessar meu CID" com autenticação por chave de acesso e recuperação segura, sem necessidade de possuir a Tag física ou conta Kyrub completa. Rota futura https://tag.kyrub.com/meu-cid; resolver acesso sem tag física e múltiplos dispositivos autorizados sem introduzir vínculo obrigatório.
- Editar CID, Localização Assistida, Ocorrências e chats, Configurar SOS, Avisos, Segurança, Visualizar meu CID público.
- Titular independente gerencia seus dispositivos e chats nesta central. Titular Kairubido pode vincular voluntariamente os dispositivos e acessá-los por Central Pessoal → Dispositivos; não perder configuração ou histórico. Kairub-se! continua convite.
- Acesso a chat por notificação individual protegida ou pela central autenticada; revogar sessões/convites, limitar escopo, histórico e exportação somente de ocorrências autorizadas. Identificação visual não substitui autorização de operações sensíveis.

## Localização Assistida
- NFC passivo não contém GPS, bateria ou conexão. A URL pode ser compartilhada/clonada; acesso HTTP não prova leitura NFC nem presença física. Mostrar "Último acesso" com horário, sem alegar rastreamento.
- Localização precisa é opcional, solicitada explicitamente ao visitante no formulário de alerta; informar destinatários, finalidade e precisão. Não impedir alerta sem GPS. Sem localização em segundo plano. Exibir "Localização compartilhada" com horário, origem e margem de precisão; não chamá-la de coordenada comprovada da Tag.
- Região aproximada de conexão por IP pode ser estimada pelo servidor sem permissão GPS, sujeita a limitações de rede móvel, VPN e proxies. É informação da conexão, não da Tag. Não disponibilizar localização individual inferida automaticamente ao titular por padrão; avaliar finalidade, necessidade, transparência, agregação e privacidade antes de qualquer exposição. Nunca disponibilizar IP bruto, porta ou identificadores de outros participantes ao titular. Dados técnicos restritos não são um serviço de rastreamento.
- Preparar modelo de registros por origem (interação, localização voluntária, futuro dispositivo equipado com GPS). LoRa isoladamente não fornece coordenadas nem garante cobertura. Futuras integrações GPS/LoRa dependem de hardware, conectividade e homologação. Funcionalidade independente de conta completa.

## Evidências e cooperação com autoridades
- Menu de três pontos no chat: Participantes, Localização compartilhada, Baixar conversa, Relatório da ocorrência, Preservar evidências, Denunciar ocorrência, Encerrar ocorrência (ações conforme papel).
- Exportação do titular: mensagens autorizadas, horários, motivo, identificador da Tag, histórico e coordenadas voluntariamente compartilhadas com precisão; PDF com identificador, emissão, mecanismo de verificação de integridade. Não incluir credenciais, tokens, IP bruto, portas, dados de dispositivo ou identificadores de outros participantes. Região aproximada por IP somente após avaliação jurídica e de privacidade; não expor eventos individuais de visitantes por padrão. Não prometer autenticidade probatória absoluta.
- Camada técnica restrita: IP de origem confiável quando disponível, instante UTC, porta de origem se infraestrutura realmente disponibilizar, navegador/SO declarados pelo cliente, identificador interno de sessão (não segredo), registros técnicos, trilha de integridade e histórico de alterações. Não coletar IMEI, fingerprint invasivo ou GPS sem permissão. Não inferir autoria ou localização física comprovada. Auditar quais campos Vercel e infraestrutura de rede efetivamente fornecem; cabeçalhos encaminhados precisam de validação da cadeia de confiança.
- Control Plane: área restrita de Preservação de Evidências e Cooperação com Autoridades. Acesso mínimo necessário, segregado, auditado; preservar por solicitação conforme fundamento, prazos e procedimento legal; retenção e descarte documentados, segurança e controle de acesso. Fornecimento mediante procedimento legal aplicável, não diretamente a particulares. Validar Marco Civil, LGPD e demais requisitos com responsável jurídico; nenhuma coleta adicional de produção autorizada por esta especificação.

## Sequenciamento
1. Encerrar PR visual #1348.
2. Compartilhamento e reconhecimento de titular em PR própria, mantendo recuperação.
3. Pix direto em PR isolada com testes de segurança e compatibilidade.
4. Política SOS revisada, formulário, configuração privada, verificação de canais e persistência transacional, seguidos de chat e notificações simuladas.
5. Central do Titular, Localização Assistida voluntária, exportação e segurança, com validação de privacidade e retenção antes da ativação.
6. Integrações reais de mensagens e dispositivos, condicionadas a orçamento, autorização e homologação.
7. Migração de rotas/subdomínios em ciclo posterior.
Não contratar serviços, modificar Firebase de produção, alterar DNS, realizar merge ou deployment sem autorização específica.
