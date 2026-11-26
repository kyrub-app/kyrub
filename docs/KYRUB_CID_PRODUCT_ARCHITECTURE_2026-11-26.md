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
- QR estático e Pix Copia e Cola equivalentes, conforme especificação vigente do Banco Central, com validação e testes de payload. Não afirmar verificação bancária da titularidade ou confirmação de pagamento. Orientar pagador a verificar beneficiário no banco.
- Proteger alterações por autenticação recente do titular, auditoria sem registrar chave em logs e notificação quando disponível. Não publicar rascunho sem consentimento. Bloqueio do cartão impede acesso público.

## SOS
Abrir painel não envia alerta. Após confirmação explícita, registrar ocorrência e enviar aviso aos contatos de emergência consentidos e cópia automática ao celular verificado do titular (SMS). Quando houver conta vinculada, integrar Avisos. Telefone do titular permanece privado.
- Titular pode informar "Estou bem / acionamento indevido", com atualização aos contatos originalmente avisados.
- Proteger contra spam, fraude e duplicidade com limites, idempotência e controles de abuso. Histórico privado; status de entrega distinto do envio solicitado; não prometer recebimento ou atendimento emergencial. Preservar acesso a 190/192/193 sem depender do fluxo de SMS.
- Homologar com provedor simulado, sem disparos reais; contratação, custo por mensagem, limites orçamentários e ativação produtiva dependem de autorização. Não enviar localização sem consentimento.
- Definir retenção, verificação dos números e consentimento dos contatos antes de habilitar.

## Sequenciamento
1. Encerrar PR visual #1348.
2. Compartilhamento e reconhecimento de titular em PR própria, mantendo recuperação.
3. Pix direto em PR isolada com testes de segurança e compatibilidade.
4. SOS automatizado em PR isolada, inicialmente sem envio real, com homologação e orçamento.
5. Migração de rotas/subdomínios em ciclo posterior.
Não contratar serviços, modificar Firebase de produção, alterar DNS, realizar merge ou deployment sem autorização específica.
