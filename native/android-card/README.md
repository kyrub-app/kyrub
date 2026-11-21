# Kairub NFC experimental — smartphone como cartão de visita
Aplicativo Android independente para validar **emulação NFC Forum Type 4 NDEF via HCE**, antes de incorporar ao Kyrub nativo. Não é a PWA, não está publicado na loja e não há vínculo com conta. O celular transmissor precisa de HCE, NFC ligado e tela desbloqueada. O receptor precisa de suporte ao protocolo/leitura NDEF Type 4; a detecção automática sem app deve ser comprovada em aparelhos reais, não presumida. A URL é digitada/colada manualmente do cartão público verificado no Kyrub. A aplicação só aceita a rota pública canônica, não consulta internet, não tem permissões de rede, não guarda credenciais nem permite UPDATE BINARY. Emulação limitada a 120 s, desarmada ao sair da tela, AID não financeiro (category other); o identificador NFC UID não é identidade. Não substitui leitura de tag física nem altera pagamentos.
 
## Build e testes
JDK 17, Gradle 8.9, Android SDK 35. Execute `gradle -p native/android-card :app:assembleDebug` em ambiente de desenvolvimento Android. O APK debug é experimental, não assinado para distribuição comercial. Teste puro do protocolo: `javac -d /tmp/kairub-card native/android-card/app/src/main/java/com/kyrub/cardprototype/Type4PublicCard.java native/android-card/tests/Type4PublicCardTest.java && java -cp /tmp/kairub-card com.kyrub.cardprototype.Type4PublicCardTest`.
 
## Homologação física obrigatória
1. Instalar APK de teste no Android transmissor compatível. Não ativar como aplicativo de pagamento.
2. Copiar endereço confirmado na Central Pessoal do Kyrub, colar no protótipo, tocar Ativar.
3. Aproxime o receptor Android desbloqueado com NFC ativado, sem o Kyrub instalado; verificar se o SO oferece abrir a URL. Repita em modelos diferentes e iPhone compatível. Se não reconhecer automaticamente, teste leitor ISO-DEP com AID e comandos previstos; não declare suporte universal.
4. Desativar e confirmar ausência de conteúdo; repetir após 2 min e ao sair da tela.
5. Confirmar que carteira/pagamentos continuam operando normalmente. Testes de laboratório não comprovam homologação em todos os telefones.
 
Referência: https://developer.android.com/develop/connectivity/nfc/hce . O serviço implementa sequência de seleção de app, CC e NDEF file, leitura binária e recusa de comandos de escrita; é um protótipo, não certificação NFC Forum.
