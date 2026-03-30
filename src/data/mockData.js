const now = new Date();
const addDays = (days) => {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

export const mockCurrentUser = {
  id: "treasurer-1",
  nome: "Tesouraria Central",
  email: "tesouraria@igreja.org",
  role: "treasurer"
};

export const mockAuxiliaryUser = {
  id: "aux-1",
  nome: "Tesoureiro Auxiliar",
  email: "auxiliar@igreja.org",
  role: "assistant",
  pin: "1234"
};

export const mockUsers = [
  mockCurrentUser,
  mockAuxiliaryUser,
  {
    id: "member-1",
    nome: "Carlos Almeida",
    email: "carlos@igreja.org",
    role: "member",
    publicToken: "publico-pessoa-member-1"
  },
  {
    id: "member-2",
    nome: "Ana Souza",
    email: "ana@igreja.org",
    role: "member",
    publicToken: "publico-pessoa-member-2"
  }
];

export const mockAdvances = [
  {
    id: "ad-1",
    usuarioId: "member-1",
    usuarioNome: "Carlos Almeida",
    valor: 350,
    dataAdiantamento: now.toISOString(),
    prazoDias: 15,
    dataLimite: addDays(15),
    status: "PENDENTE",
    descricao: "Compra de materiais para ação social",
    justificativa: "",
    totalComprovado: 0,
    lancadoAcms: false,
    dataLancamentoAcms: "",
    comprovantes: [],
    createdBy: "treasurer-1",
    publicToken: "publico-pessoa-member-1"
  },
  {
    id: "ad-2",
    usuarioId: "member-2",
    usuarioNome: "Ana Souza",
    valor: 600,
    dataAdiantamento: addDays(-20),
    prazoDias: 15,
    dataLimite: addDays(-5),
    status: "ATRASADO",
    descricao: "Compra de alimentos para confraternização",
    justificativa: "",
    totalComprovado: 0,
    lancadoAcms: false,
    dataLancamentoAcms: "",
    comprovantes: [],
    createdBy: "treasurer-1",
    publicToken: "publico-pessoa-member-2"
  }
];

export const mockAuthorizations = [
  {
    id: "auth-1",
    advanceId: "ad-1",
    assistantId: "aux-1",
    assistantName: "Tesoureiro Auxiliar",
    memberName: "Carlos Almeida",
    amount: 350,
    description: "Entregar antes do culto de sábado",
    createdAt: now.toISOString(),
    status: "AUTORIZADO",
    audioUrl: "",
    audioName: "",
    deliveredAt: ""
  }
];

export const mockHistory = [
  {
    id: "hist-1",
    advanceId: "ad-1",
    type: "ADIANTAMENTO_CRIADO",
    message: "Adiantamento criado pela tesouraria.",
    createdAt: now.toISOString()
  }
];

export const mockFileFolders = [
  {
    id: "folder-1",
    name: "Notas fiscais",
    description: "Notas e comprovantes para consulta rapida.",
    parentId: "",
    deletedAt: "",
    createdBy: "treasurer-1",
    createdAt: now.toISOString()
  },
  {
    id: "folder-2",
    name: "Depositos",
    description: "Comprovantes de transferencia e deposito.",
    parentId: "",
    deletedAt: "",
    createdBy: "treasurer-1",
    createdAt: addDays(-2)
  },
  {
    id: "folder-3",
    name: "Marco",
    description: "Documentos organizados por mes.",
    parentId: "folder-1",
    deletedAt: "",
    createdBy: "treasurer-1",
    createdAt: addDays(-1)
  }
];

export const mockFileAssets = [
  {
    id: "asset-1",
    folderId: "folder-3",
    title: "nota-mercado.jpg",
    originalFileName: "nota-mercado.jpg",
    fileType: "image",
    mimeType: "image/jpeg",
    cloudinaryPublicId: "",
    secureUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=900&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=320&q=70",
    notes: "Nota do mercado para conferencia.",
    digitized: false,
    digitizedAt: "",
    deletedAt: "",
    uploadedBy: "treasurer-1",
    createdAt: addDays(-1)
  },
  {
    id: "asset-2",
    folderId: "folder-2",
    title: "deposito-marco.pdf",
    originalFileName: "deposito-marco.pdf",
    fileType: "pdf",
    mimeType: "application/pdf",
    cloudinaryPublicId: "",
    secureUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    thumbnailUrl: "",
    notes: "Comprovante de deposito do caixa.",
    digitized: true,
    digitizedAt: addDays(-1),
    deletedAt: "",
    uploadedBy: "treasurer-1",
    createdAt: now.toISOString()
  }
];
