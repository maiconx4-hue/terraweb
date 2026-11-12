# Atualização Terra Web — mapa 2D Vector + exploração 3D

## O que mudou

- O mapa 2D existente continua sendo o motor principal de edição.
- A inicialização do Google Maps solicita renderização `VECTOR`, zoom fracionário e interação de inclinação/rumo.
- O `mapId` pode ser configurado pela variável `VITE_GOOGLE_MAP_ID`. Sem ela, o mapa 2D usa `google.maps.Map.DEMO_MAP_ID` como fallback de desenvolvimento.
- Foi adicionado `Map3DView.tsx`, baseado na biblioteca oficial `maps3d` do Google Maps JavaScript API.
- O modo 3D exibe marcadores, polígonos e caminhos derivados dos mesmos `GeoNode` usados pelo modo 2D.
- O modo 3D oferece rotação/inclinação por gestos, retorno ao norte, centralização e animação orbital.
- A instância 2D não é destruída quando o usuário alterna para 3D. A instância 3D também permanece montada depois da primeira abertura, preservando sua câmera ao alternar entre modos.

## Limites funcionais desta primeira integração

- A edição geométrica (criar, arrastar vértices, editar polígonos/caminhos e régua) continua no modo 2D.
- O modo 3D é, nesta versão, para exploração e seleção visual dos objetos. A seleção de objetos depende dos elementos interativos 3D disponibilizados pela versão da API carregada.
- Os dados continuam sendo gravados no mesmo localStorage/Supabase e exportados pelo mesmo fluxo KML/KMZ.
- O modo 3D depende da disponibilidade da biblioteca `maps3d`, permissões/faturamento da chave e cobertura de imagens 3D da região. A cobertura fotorrealista não é uniforme em todas as cidades.
- Esta integração não promete eliminar artefatos de carregamento de tiles do Google Maps. A renderização VECTOR melhora a experiência de câmera, mas o carregamento de imagens continua sob controle do Google.

## Configuração recomendada no Google Cloud / Lovable

1. No projeto Google Cloud associado à chave atual, confirme que a **Maps JavaScript API** está habilitada e com faturamento ativo.
2. Crie um **Map ID** para uso web e habilite o mapa vetorial conforme as opções disponíveis no console.
3. Configure `VITE_GOOGLE_MAP_ID` nas variáveis de ambiente/secrets da aplicação Lovable com esse Map ID.
4. Mantenha `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` e `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID` conforme já configurados no projeto.
5. Verifique as restrições HTTP referrer da chave para `terraweb.lovable.app` e os domínios de preview/desenvolvimento usados pela equipe.
6. Confirme que a biblioteca/recursos **Maps 3D** estão disponíveis para a chave e para a conta de faturamento.

Não coloque a chave do Google Maps no código-fonte nem neste repositório. Configure-a somente nas variáveis de ambiente protegidas do projeto.

## Instalação pelo GitHub

1. Faça download/backup do repositório atual antes de substituir arquivos.
2. No GitHub, substitua `src/components/earth/EarthApp.tsx` pelo arquivo deste pacote.
3. Adicione `src/components/earth/Map3DView.tsx`.
4. Adicione este arquivo de documentação se desejar manter o histórico técnico.
5. Faça commit diretamente na branch `main`.
6. Aguarde a sincronização da Lovable e a conclusão do build/deploy.
7. Configure `VITE_GOOGLE_MAP_ID` nos secrets/variáveis da Lovable e faça novo deploy se necessário.

**Não substitua nem apague o `.env` local, os secrets da Lovable, nem as configurações do Supabase.** O ZIP de entrega omite intencionalmente arquivos `.env` para não transportar credenciais.

## Roteiro de testes

- Abrir `/mapa`: mapa 2D deve continuar iniciando.
- Verificar zoom fracionário e rotação/inclinação no modo 2D.
- Alternar para `3D Orbital`: deve abrir a visualização 3D.
- Testar rotação, inclinação, botão Norte e botão Órbita.
- Selecionar objetos no 3D e conferir o painel de propriedades.
- Alternar de volta para 2D e conferir que câmera, pastas e dados permanecem.
- Testar zoom para pasta/objeto e busca por coordenadas.
- Testar importação/exportação KML/KMZ no modo 2D.
- Testar Street View e ferramentas de desenho no modo 2D.
- Repetir os testes com um projeto contendo muitos marcadores.

Se o modo 3D exibir mensagem de indisponibilidade, mantenha o trabalho no modo 2D e verifique a chave, Map ID, faturamento, permissões e cobertura da região antes de tentar alterar o código.
