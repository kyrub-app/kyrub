# Kyrub Tag — primeiro adesivo de teste (PILOTO 01)

**Data:** 2026-11-23  
**Status:** roteiro preparado, não executado com hardware real.  
**Escopo:** uma unidade promocional de homologação, sem destinatário pré-cadastrado e sem alterar dados ou regras de produção.

## A decisão mais importante

A prévia atual da Vercel utiliza as mesmas variáveis Firebase que a produção. **Isso não é isolamento real.** Nenhuma flag de emissão ou ativação deve ser ligada nesse ambiente. Um servidor de prévia conectado ao Firebase `kyrub-b8d0e` não deve emitir, reivindicar, editar ou recuperar tags promocionais.

Há uma proteção explícita de servidor em `server/identity/kyrubTagPilotIsolation.ts`: alterações promocionais só são permitidas em **emuladores locais com IDs `demo-` e Auth + Firestore locais**, ou em um projeto Firebase de homologação cujo ID corresponda à variável `KYRUB_TAG_PROMO_PILOT_PROJECT_ID`, seja diferente de `kyrub-b8d0e` e coincida com a configuração do Firebase Web. Essa proteção é adicional às flags já existentes. O lançamento em produção requer uma revisão de arquitetura separada.

## Materiais do titular

- Um adesivo NFC novo, vazio e regravável. Não bloqueá-lo permanentemente para escrita no piloto.
- Celular Android com NFC ativo e Chrome atualizado (suporte Web NFC varia por aparelho/navegador).
- Um e-mail de teste próprio, acessível pelo Android, **preferencialmente diferente do usado na conta Kyrub existente** para não confundir a vinculação futura.
- Uma conta de Super Admin **da homologação**; o login do Control Plane em produção não habilita administração no Firebase isolado.
- Opcional: segundo telefone NFC para conferir a leitura pública independente.

**Não** anotar, enviar ao chat ou imprimir em uma etiqueta: senha, token, service-account JSON, código de recuperação. O código de recuperação deve ficar em gerenciador de senhas privado.

## Preparação técnica — sem tocar produção

1. Criar um **novo projeto Firebase exclusivo para homologação**, diferente de `kyrub-b8d0e`, registrar um aplicativo Web e configurar Firestore e Authentication. **Cloud Storage não é obrigatório para o primeiro teste sem fotos.** Desde 2026, Cloud Storage exige plano Blaze (pagamento por uso) mesmo com cota gratuita. Não mudar de plano nem vincular faturamento sem aprovação expressa do proprietário.
2. Em Authentication > Sign-in method, habilitar **Email/Password, Email link (passwordless) e Google** no projeto de homologação. O Google é necessário para o login existente do Super Admin; o Email link será usado pelo futuro titular do adesivo. Em Authorized domains, liberar somente o domínio HTTPS da prévia usada no teste. Não alterar provedores nem domínios do Firebase principal.
3. Criar um usuário administrativo de teste e seu papel Super Admin no **banco isolado**; aplicar as regras Firestore/Storage revisadas da branch **apenas nesse projeto**. Conferir que nenhuma credencial do projeto principal seja reutilizada.
4. No Vercel, configurar variáveis **Preview restritas à branch** `feat/kyrub-tag-promotional-activation-v1`:
   - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`: dados da aplicação Web **isolada**.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: credencial de serviço do **projeto isolado**, inserida diretamente no painel seguro, não no chat/GitHub. Não sobrescrever a variável compartilhada de Production.
   - `KYRUB_TAG_PROMO_PILOT_PROJECT_ID`: ID do **projeto isolado**.
   - `VITE_KYRUB_TAG_MINIMAL_IDENTITY_GATE=true`, `KYRUB_TAG_PROMO_ISSUANCE_ENABLED=true`, `KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED=true` **somente nessa branch e depois do preflight de isolamento**.
5. Recriar a prévia da branch para aplicar variáveis de build e servidor. O formulário Web de email-link deve usar o mesmo domínio autorizado do teste.
6. Abrir o **endereço da prévia Vercel** no Chrome com o parâmetro `?kyrub_admin_preview=1` para mostrar o Control Plane da prévia (o domínio oficial `admin.kyrub.com` continua em produção). Entrar com a conta Google Super Admin **de homologação**, provisionada no Firestore isolado. Em **Kyrub Tag — adesivos promocionais**, conferir os indicadores `isolated-project`, Firebase Web e Admin coincidentes, e liberação de emissão. Se disser “Bloqueado”, interromper — nunca tentar desligar a proteção pelo console.

## Gravação sequencial sem digitação por unidade

O Control Plane da prévia tem um **assistente de gravação sequencial** como fluxo principal. Em vez de pedir quantidade, senha ou identificador a cada adesivo, o administrador toca **Iniciar gravação**; o servidor emite de forma idempotente um novo ID, um adesivo por vez, e a interface prepara a URL temporária da prévia isolada. O operador toca **Gravar · aproximar adesivo vazio** e aproxima uma unidade física. A gravação NDEF usa `overwrite:false`, para evitar apagar outra etiqueta já preenchida.

Depois de gravar, o navegador tenta iniciar a leitura; o operador deve afastar e aproximar o mesmo adesivo. Se o Android bloquear o início automático, há o botão **Conferir leitura NFC**, solicitado diretamente por gesto do usuário. Somente um único registro NDEF do tipo URL idêntico à URL exclusiva da unidade permite enviar ao servidor o evento **`browser_readback_confirmed`**. Somente após o servidor confirmar esse evento aparece **Próximo adesivo**, que prepara outro ID automaticamente.

Em divergência, erro de permissão ou conexão interrompida, **não** marcar como conferido; repetir a leitura ou retomar a unidade pendente pelo inventário. A operação é Super Admin e fica indisponível em Firebase de produção/preview não isolado. O inventário possui marcação de conferência **relatada pelo navegador**, e não uma prova criptográfica de chip único ou original; alguns chips NFC têm IDs ausentes, mutáveis ou clonáveis. Não usar isso para autenticação de produtos oficiais comercializados.

Para a primeira rodada, a emissão automática é uma unidade de cada vez; a emissão manual de 1 a 10 unidades permanece acessível como ferramenta avançada. O sistema não grava em lote sem intervenção do usuário: o Chrome/Android controla permissões e requer aproximação física. Não usar `makeReadOnly()` no piloto, pois a URL temporária terá de ser substituída em lançamento futuro.

## Operação do primeiro adesivo

1. Na seção **Gravação sequencial**, tocar **Iniciar gravação**. O sistema emite exatamente 1 ID novo e prepara a URL sem exigir digitação. Verificar que a unidade experimental 001 permaneceu inalterada.
2. O endereço oficial `https://kyrub.com/tag/{id}` é apenas um **endereço reservado para um lançamento futuro**; **não gravá-lo para o piloto isolado**. Selecionar a **URL temporária de homologação** mostrada pelo painel em uma prévia `*.vercel.app` e conferir que o domínio consta na lista de domínios autorizados do Firebase de testes.
3. Em Android Chrome, tocar **Gravar · aproximar adesivo vazio** e aproximar **um adesivo vazio**. A escrita usa NDEF e `overwrite:false`; se o navegador disser incompatível, não alterar o domínio ou gravar um link de produção como alternativa.
4. Afastar o adesivo e reaproximar para a leitura automática do assistente ou tocar em **Conferir leitura NFC** se o Android exigir novo gesto. Confirmar mensagem de **Informações válidas** e registro no inventário. Fazer uma segunda conferência independente com outro navegador/celular: deve abrir a **URL temporária da prévia**, não o site produtivo.
5. Na primeira leitura, preencher nome, profissão e apresentação opcionais, confirmar e-mail de teste pelo link, ativar a unidade e guardar o código de recuperação **fora do adesivo e do chat**. A primeira rodada pode ocorrer sem fotos; a mídia será testada em emulador ou num Firebase isolado com Storage deliberadamente autorizado.
6. Testar o cartão público em outro navegador/telefone: SOS 190/192/193 e até dois contatos de confiança **de teste e autorizados**. Fotos somente se Storage tiver sido habilitado no ambiente isolado com aprovação de custos. Não executar chamadas reais para serviços de emergência. O endereço de e-mail e os contatos ocultos não devem aparecer.
7. No painel de titular: editar, publicar, bloquear por perda, verificar que imagem e cartão deixaram de responder, desbloquear, publicar novamente e substituir o código de recuperação.
8. Usar um segundo e-mail de teste verificado e o código de recuperação para ensaiar a recuperação, com código antigo invalidado e a tag inicialmente bloqueada.
9. Verificar no Firestore isolado que **nenhuma conta Kyrub completa nem loja** foi criada automaticamente, e que nenhuma unidade 001, loja ou assinatura de produção foi alterada.
10. Encerrar o piloto, desabilitar as 3 flags e registrar resultado. **Não distribuir nem marcar este adesivo como definitivo**: a URL do piloto poderá expirar, e o chip precisará ser regravado com a URL oficial quando o lançamento de produção for homologado.

## Aceite

- [ ] Preflight confirma projeto Firebase isolado e alinhamento Web + servidor
- [ ] Firebase Email link envia e completa login no Android
- [ ] Emissão de 1 unidade com auditoria e sem duplicidade
- [ ] Gravação e leitura física confirmadas
- [ ] Primeiro titular verificado e sem cadastro completo automático
- [ ] Cartão público exibe só dados autorizados
- [ ] Fotos deixam de ser entregues após bloqueio
- [ ] Edição, bloqueio, desbloqueio e recuperação verificados
- [ ] Novo código invalida o anterior
- [ ] Nenhuma gravação no Firebase produtivo `kyrub-b8d0e`
- [ ] Unidade piloto 001 intacta
- [ ] Flags novamente desabilitadas após o teste

**Observação:** a primeira ativação promocional pode ser feita por quem receber ou ganhar de presente o adesivo. O primeiro e-mail verificado que concluir a reivindicação torna-se titular. Essa regra não vale automaticamente para produtos oficiais comercializados.
