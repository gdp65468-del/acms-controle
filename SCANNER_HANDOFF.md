# Scanner Rápido ACMS Drive — transferência para a Etapa 2

## Atualizacao Android nativo - APK de teste

- Foi adicionado um projeto Capacitor Android em `android/`, com identificador `com.acmscontrole.mobile` e Android minimo 7.0 (API 24).
- O arquivo `capacitor.config.ts` aponta para `https://acms-controle.vercel.app`. Portanto, o APK e online: ele usa o login Firebase, as APIs e os mesmos dados da versao publicada, sem incluir credenciais no app.
- Em Android, `src/utils/nativeCamera.js` chama `@capacitor/camera`. O plugin abre a camera nativa do aparelho para cada captura e devolve a foto ao Scanner Rapido, que preserva a fila IndexedDB e o upload existente para Cloudinary/Firestore.
- A camera Samsung, e nao a WebView, passa a controlar foco por toque, autofocus, lentes/zoom e lanterna. O modo continuo continua no Scanner: apos confirmar na camera nativa, a foto e enfileirada e o botao permite abrir a proxima captura.
- O service worker PWA nao e registrado dentro do APK, evitando interferencia com a ponte nativa do Capacitor.
- Comandos: `npm run android:sync` atualiza o modulo Android; `npm run android:apk` gera o APK debug em `android/app/build/outputs/apk/debug/app-debug.apk`.
- Validacao local: build web aprovado, `npm test` aprovado e `assembleDebug` aprovado com Java 21. O APK foi inspecionado com `aapt`: pacote correto, minSdk 24, targetSdk 36 e permissao apenas de Internet. A assinatura e a debug padrao; ela serve para instalar e homologar, nao para publicar na Play Store.

### Homologacao pendente no S24

1. Instalar o APK e abrir com Internet ativa; confirmar login, pagina Arquivos e scanner.
2. No Scanner Rapido, tocar no obturador: a Camera Samsung deve abrir. Testar foco por toque, 1x/2x/lentes oferecidas pelo aparelho, lanterna e tirar uma foto.
3. Ao voltar ao ACMS, confirmar miniatura, fila, upload e o arquivo na pasta atual. Testar uma sequencia de fotos e modo Conferencia.
4. O aplicativo depende da Vercel estar atualizada, pois foi configurado como app online. A primeira abertura requer rede; fotos pendentes continuam usando a fila local existente apos a captura retornar ao app.

## Ajuste de foco para recibos — 09/11/2026

- `src/utils/scannerFocus.js` solicita foco contínuo, ou single-shot quando for a única opção automática. O pedido mantém as constraints de resolução, lanterna e zoom. Alterar zoom/lanterna também preserva o foco.
- Ao abrir ou trocar a câmera, o scanner restaura 1x quando essa escala existir, pois é a opção adequada para recibos próximos. O 2x continua disponível para documentos fotografados a maior distância e mostra essa orientação na tela.
- O toque usa a posição do texto no vídeo, compensando `object-fit: cover`, com `pointsOfInterest: [{x, y}]` normalizados. Só solicita o ponto quando o navegador declara suporte. Se o ponto for rejeitado, tenta apenas autofocus; informa essa limitação na interface.
- O indicador mostra uma solicitação, nunca confirmação de nitidez. Depois da aplicação há 800 ms de estabilização antes de liberar o obturador. Não há evento web confiável de foco concluído; o usuário ainda deve conferir a nitidez. Pedido sem resposta libera a captura após 3 segundos.
- Troca de câmera/finalização invalida o pedido pendente e limpa o temporizador. Conferência não altera foco. Removido o temporizador que alternava single-shot para contínuo após 500 ms.
- O scanner preenche o viewport com `inset: 0` e bloqueia a rolagem da página enquanto estiver aberto, evitando exibir o Drive abaixo da câmera em navegadores móveis.
- `test/scannerFocus.test.mjs` testa geometria, preservação de ajustes, câmeras sem suporte, fallback, rejeições e tracks encerrados com câmeras simuladas. Não valida foco óptico em aparelho físico.
- Homologar no S24 via HTTPS: texto miúdo e códigos de barras, toques fora do centro, 1x/2x, lanterna, captura após toque e troca/fechamento durante tentativa de foco. Verificar o arquivo salvo além da prévia; processamento e compressão continuam os existentes. Alguns navegadores não expõem foco/ponto de interesse, e nenhuma opção web força suporte nem supera a distância mínima da lente.

## Escopo implementado

O Scanner Rápido é aberto pelo menu **Criar ou carregar** em `/arquivos`. Ele recebe `currentFolderId`, `currentPath` e o usuário autenticado da `FilesPage`; portanto, cada captura usa a pasta que estava aberta. O acesso continua protegido pela rota e pelo fluxo de tesoureiro já existentes. Nenhuma regra de autenticação ou credencial foi adicionada ao frontend.

Arquivos do scanner:

- `src/components/QuickScanner.jsx`: câmera, interface, modos Contínuo/Conferência, controles, refazer e resumo.
- `src/services/scannerQueue.js`: fila persistente em IndexedDB, recuperação, concorrência e reenvio.
- `src/utils/fileAssets.js`: `captureScannerFrame`, que gera JPEG do vídeo e nome automático.
- `src/pages/FilesPage.jsx` e `src/styles.css`: entrada no menu e layout mobile-first.
- `src/services/appService.js` e `src/services/localDb.js`: passagem dos identificadores e integração com o fluxo de upload existente; `localDb` é apenas o modo de demonstração sem Firebase.
- `api/files/upload.js` e `api/_lib/cloudinary.js`: idempotência por captura, `public_id` determinístico, substituição segura e gravação dos metadados.

`src/pages/DriveUploadPage.jsx` e `api/_lib/driveUpload.js` pertencem ao upload temporário via QR Code e não foram alterados para o scanner. O scanner usa `/api/files/upload`, não a API de sessão temporária. O visualizador, a lixeira, a navegação por `folderId` e a assinatura em tempo real dos arquivos continuam os já existentes.

## Fluxo

1. `getUserMedia` solicita preferencialmente a câmera traseira. A imagem ao vivo é desenhada em `canvas`, limitada a 1800 px no maior lado e convertida para JPEG (qualidade 0,88). A orientação do frame é a orientação fornecida pelo navegador. O `prepareFileForUpload` existente pode comprimir mais a imagem antes da rede.
2. No modo Contínuo, cada foto é gravada primeiro como `Blob` no IndexedDB e depois enfileirada; a câmera segue aberta. No modo Conferência, a foto é mostrada e só entra na fila após **Continuar e enviar**. Trocar o modo não apaga capturas.
3. A fila tem no máximo dois uploads ativos. Cada item contém UUID, dono, pasta, sessão, nome, estado e tentativas. Há até três tentativas automáticas, botão manual para falhas e retomada quando a rede volta ou o scanner é reaberto. Um item `uploading` deixado por uma página encerrada volta a `queued` na reabertura.
4. `appService.uploadFileAsset` usa a autenticação do tesoureiro e envia `scannerCaptureId` e, quando aplicável, `scannerReplaceAssetId` para `/api/files/upload`. A API valida o UUID, JPEG e a pasta, envia ao Cloudinary com `public_id` determinístico e cria o documento em `arquivos` numa transação Firestore. O status inicial é `digitized: false` (Pendente no ACMS). A mesma transação atualiza `resumos_drive/geral`.
5. A fila só marca `saved` após resposta positiva da API. Nesse momento remove o Blob local. O UUID como ID do documento Firestore e a consulta inicial impedem a duplicação de metadados em reenvios.
6. Para **Refazer** uma foto já salva, a foto original permanece disponível. A nova captura leva o ID original; somente após o novo documento ser criado a transação marca o original como excluído (`deletedAt`) e ajusta o total de bytes. Para fotos ainda na fila, Refazer descarta a última, desde que seu upload não esteja ativo.
7. **Finalizar** encerra os recursos da câmera e mostra contadores. Fechar a tela não elimina a fila pendente. O upload em curso continua enquanto a aplicação permanecer aberta; após fechar/recarregar a aba, itens pendentes retomam quando o scanner for aberto novamente.

## Decisões e limites conhecidos

- IndexedDB mantém fotos pendentes apenas **neste navegador e dispositivo**, vinculadas ao UID; não há sincronização entre dispositivos nem criptografia adicional em repouso. O navegador/usuário pode limpar esses dados, e limites de armazenamento variam. A interface avisa quando existem pendências.
- Cloudinary pode já ter recebido o arquivo quando uma falha ocorre antes da confirmação do Firestore. O `public_id` determinístico permite repetir o envio sem gerar novos documentos, mas podem restar objetos órfãos se o backend falhar definitivamente. A Etapa 2 deve auditar esse caso.
- A correção de orientação é a do frame de vídeo entregue pelo navegador; não há leitura de EXIF, detecção de bordas nem correção de perspectiva. A legibilidade em diferentes resoluções e o limite multipart de 10 MB requerem teste real.
- O modo de demonstração (`localDb`) armazena imagens como data URL no `localStorage`, que pode atingir a cota rapidamente. O IndexedDB retém a captura que não conseguir concluir; isso não substitui a validação com Firebase/Cloudinary reais.
- A fila é iniciada quando a tela do scanner abre. Um Service Worker/background sync não foi introduzido; após encerrar o navegador, é preciso reabrir o scanner para retomar.
- A tela de resumo exibe pendências recuperadas da mesma pasta além das capturas da sessão atual. Validar os rótulos/contadores com sessões intercaladas na Etapa 2.
- Mudanças de armazenamento do Drive e outras alterações preexistentes no worktree não fazem parte do scanner; preservar durante a revisão.

## Validação solicitada para a Etapa 2

1. Testar em celular real com HTTPS: permissão negada, câmera traseira, alternância, lanterna, safe areas, telas pequenas, rotação do dispositivo e liberação dos tracks.
2. Testar captura contínua de dezenas de documentos e modo Conferência, inclusive alternando modos e usando Refazer durante envio.
3. Testar rede intermitente, recarga/fechamento da aba, cota do IndexedDB, reenvios e confirmação do backend; verificar que não aparecem documentos duplicados.
4. Testar substituição salva e falha de substituição: original preservado até sucesso; verificar lixeira e total de armazenamento.
5. Verificar Firestore, Cloudinary e atualização em tempo real da pasta correta com credenciais de homologação; conferir permissões e eventuais objetos Cloudinary órfãos.
6. Avaliar legibilidade de comprovantes pequenos, orientação, tamanho final do JPEG e comportamento no modo de demonstração.

Não houve deploy automático. Esta Etapa 1 se limita a implementação, build e checagens rápidas; a auditoria e os testes extensos ficam para a Etapa 2.

## Atualização da Etapa 2

### Correções aplicadas

- A fila passou a manter o uploader associado ao respectivo usuário enquanto há envios ativos. Uma mudança de sessão não reaproveita mais o uploader de outro usuário.
- A mesma captura não sobrescreve uma entrada já persistida no IndexedDB. Reenvio manual reinicia as tentativas e as ações de reenviar ou descartar exigem o mesmo `ownerUid` da captura.
- Itens sem Blob recuperável passam para erro explícito, em vez de tentar enviar um arquivo vazio. Metadados de itens salvos/substituídos são removidos após 24 horas; o Blob continua sendo removido assim que o backend confirma o salvamento.
- A tela separa a última captura da sessão atual das pendências recuperadas de sessões anteriores e informa estas pendências ao usuário.
- O servidor do scanner agora deriva a pasta Cloudinary a partir de `folderId` no Firestore, valida o cabeçalho JPEG e o UUID de substituição, normaliza nomes e ignora `uploadedBy` enviado pelo cliente.
- Se o Cloudinary aceitar uma captura e a transação Firestore falhar, a API tenta remover a imagem recém-enviada para reduzir objetos órfãos. A substituição ainda preserva o original até a transação ser concluída.
- Foram adicionados testes com `node:test` para limite de concorrência, confirmação somente após upload, idempotência local, falha, reenvio e isolamento por usuário.
- Dependências foram atualizadas dentro do fluxo de auditoria, incluindo React Router, Firebase e Firebase Admin. A auditoria de produção não possui mais vulnerabilidades críticas.

### Validação executada na Etapa 2

- `npm test`: aprovado (3 testes da fila).
- `npm run build`: aprovado.
- `git diff --check`: aprovado.
- Servidor Vite local: resposta HTTP 200.
- Checagem de sintaxe Node para a API, Cloudinary e fila: aprovada.

### Limitações que permanecem para homologação manual

- Não havia navegador ou aparelho físico disponível neste ambiente. Ainda é preciso homologar Android Chrome e iPhone Safari com HTTPS, permissão real de câmera, troca de lente, lanterna, orientação, safe areas e encerramento dos tracks.
- Firebase/Cloudinary reais não estavam configurados neste ambiente; os testes não enviaram comprovantes financeiros nem validaram regras/URLs em uma conta real.
- A auditoria de dependências ainda aponta vulnerabilidades altas em dependências opcionais de gRPC trazidas pelo SDK Firebase web atual. A versão atual publicada pelo fornecedor ainda fixa essa faixa para essa árvore; avaliar com cuidado uma futura atualização do SDK ou um override homologado antes de produção.
- O armazenamento pendente no IndexedDB é local ao navegador. Não é possível garantir recuperação após limpeza de dados do navegador, troca de dispositivo ou limite de cota.
