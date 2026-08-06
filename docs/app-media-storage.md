# Persistência de imagens do Kyrub

Esta etapa conecta os seletores de imagem do aplicativo ao Firebase Storage, substituindo URLs temporárias, blobs e dados locais quando a imagem precisa sobreviver a recarregamentos, troca de aparelho ou acesso por outro perfil.

## Estratégia

- manter o PR de Comunidades isolado;
- criar uma camada central de upload, validação, exclusão e limpeza;
- organizar arquivos por proprietário e contexto;
- salvar apenas URLs persistentes e caminhos controlados nos documentos do Firestore;
- bloquear tipos, tamanhos e caminhos não previstos nas regras do Storage;
- não migrar silenciosamente imagens antigas sem vínculo seguro com o usuário correto.

## Escopo a mapear e implementar

- avatar e capa do perfil;
- logo e banner da loja;
- imagens de produtos e ofertas;
- imagens de publicações sociais;
- anexos visuais de notas e conversas, quando essas telas realmente persistirem o conteúdo;
- limpeza de arquivos substituídos ou removidos;
- testes de autorização e contratos de interface.

## Fluxo

- branch empilhada sobre `feat/cloud-communities-debates`;
- PR em rascunho;
- validação de build, TypeScript, regras e Vercel antes do preview;
- nenhum merge sem autorização explícita.
