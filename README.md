# ACMS Controle

MVP em `Vite + React + Firebase` para controle operacional da tesouraria, com:

- painel principal da tesouraria;
- area de arquivos com pastas e upload de imagem/PDF;
- termo de adiantamento para impressao;
- controle e lembrete de lancamento no ACMS;
- autorizacao de repasse com audio;
- area do tesoureiro auxiliar em `PWA`;
- sincronizacao em tempo real via `Firestore`.

## Rodando o projeto

1. Instale `Node.js` 20+.
2. Copie `.env.example` para `.env`.
3. Preencha as credenciais do Firebase e do Cloudinary.
4. Rode:

```bash
npm install
npm run dev
```

## Servicos esperados

- `Firestore`
- `Firebase Authentication`
- `Firebase Storage`
- `Cloudinary`

## Variaveis de ambiente

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_CLOUDINARY_CLOUD_NAME=
VITE_CLOUDINARY_UPLOAD_PRESET=
```

## Estrutura de colecoes

### `usuarios`

```json
{
  "nome": "Tesoureiro Auxiliar",
  "email": "auxiliar@igreja.org",
  "role": "assistant",
  "pin": "1234"
}
```

Papeis usados:

- `treasurer`
- `assistant`
- `member`

### `adiantamentos`

```json
{
  "usuarioId": "member-1",
  "usuarioNome": "Carlos Almeida",
  "valor": 350,
  "dataAdiantamento": "2026-03-27T00:00:00.000Z",
  "prazoDias": 15,
  "dataLimite": "2026-04-11T00:00:00.000Z",
  "descricao": "Compra de materiais",
  "justificativa": "",
  "totalComprovado": 0,
  "comprovantes": [],
  "createdBy": "uid-da-tesouraria",
  "publicToken": "token-publico"
}
```

### `autorizacoes_repasse`

```json
{
  "advanceId": "id-do-adiantamento",
  "assistantId": "id-do-auxiliar",
  "assistantName": "Tesoureiro Auxiliar",
  "memberName": "Carlos Almeida",
  "amount": 350,
  "description": "Entregar antes do culto",
  "status": "AUTORIZADO",
  "audioUrl": "",
  "audioName": "",
  "deliveredAt": ""
}
```

### `historico_eventos`

```json
{
  "advanceId": "id-do-adiantamento",
  "type": "ADIANTAMENTO_CRIADO",
  "message": "Adiantamento criado pela tesouraria.",
  "createdAt": "server timestamp"
}
```

### `pastas_arquivos`

```json
{
  "name": "Notas fiscais",
  "description": "Arquivos do mes",
  "createdBy": "uid-da-tesouraria",
  "createdAt": "server timestamp"
}
```

### `arquivos`

```json
{
  "folderId": "id-da-pasta",
  "title": "nota-mercado.jpg",
  "originalFileName": "nota-mercado.jpg",
  "fileType": "image",
  "mimeType": "image/jpeg",
  "cloudinaryPublicId": "acms-controle/notas/arquivo",
  "secureUrl": "https://...",
  "thumbnailUrl": "https://...",
  "notes": "Observacao opcional",
  "uploadedBy": "uid-da-tesouraria",
  "createdAt": "server timestamp"
}
```

## Observacoes

- sem Firebase configurado, o app entra em `modo demonstracao` com dados locais;
- o PIN do auxiliar fica salvo no `Firestore` neste MVP;
- a impressao do termo usa a janela nativa do navegador;
- o modulo de arquivos aceita apenas imagem e PDF;
- imagens sao compactadas levemente antes do upload;
- PDFs sao enviados sem compactacao;
- sem Cloudinary configurado, o modulo de arquivos continua navegavel no modo demonstracao local.
