# Reconstrução React do painel Meu Perfil

Branch de trabalho para restaurar a estrutura moderna do painel Meu Perfil sem reativar as pontes que manipulavam o DOM por fora do React.

Objetivos:
- manter a navegação estável;
- incorporar Status, Marcados, Favoritos, Grupos e Salvos diretamente no estado e na renderização do ProfileSocialHubBridge;
- preservar os dados e regras já existentes;
- validar em Preview antes de qualquer merge na main.
