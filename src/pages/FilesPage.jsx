import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { Icon } from "../components/Icon";
import { useAppContext } from "../context/AppContext";
import { formatDate } from "../utils/format";

function getDefaultTitle(file) {
  return file?.name || "";
}

function formatAssetTypeLabel(asset) {
  return asset.fileType === "image" ? "Imagem" : "PDF";
}

function buildFolderPath(folder, folders) {
  if (!folder) return "";
  const byId = new Map(folders.map((item) => [item.id, item]));
  const segments = [];
  let current = folder;
  while (current) {
    segments.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) || null : null;
  }
  return segments.join("/");
}

function getDescendantIds(folders, folderId) {
  const ids = [];
  const stack = [folderId];
  while (stack.length) {
    const currentId = stack.pop();
    const children = folders.filter((item) => item.parentId === currentId);
    children.forEach((child) => {
      ids.push(child.id);
      stack.push(child.id);
    });
  }
  return ids;
}

async function downloadAsset(asset) {
  const response = await fetch(asset.secureUrl);
  if (!response.ok) {
    throw new Error("Nao foi possivel baixar este arquivo.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = asset.originalFileName || asset.title || "arquivo";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function ActionChip({ icon, label, onClick, variant = "default", type = "button" }) {
  return (
    <button type={type} className={`files-action-chip ${variant !== "default" ? `is-${variant}` : ""}`} onClick={onClick}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );
}

function StatPill({ icon, label, value }) {
  return (
    <div className="files-summary-pill">
      <Icon name={icon} size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

export function FilesPage() {
  const { fileFolders, fileAssets, session, actions } = useAppContext();
  const [currentFolderId, setCurrentFolderId] = useState("");
  const [currentSection, setCurrentSection] = useState("drive");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSidebar, setShowSidebar] = useState(false);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [renameModal, setRenameModal] = useState(null);
  const [moveModal, setMoveModal] = useState(null);
  const [menuState, setMenuState] = useState(null);
  const [viewMode, setViewMode] = useState("grid");
  const [lightboxAsset, setLightboxAsset] = useState(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxOffset, setLightboxOffset] = useState({ x: 0, y: 0 });
  const [lightboxDragging, setLightboxDragging] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrFolder, setQrFolder] = useState(null);
  const [qrSession, setQrSession] = useState(null);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [folderForm, setFolderForm] = useState({ name: "", description: "" });
  const [uploadForm, setUploadForm] = useState({ title: "", notes: "" });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState("success");
  const [uploading, setUploading] = useState(false);
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const lightboxDragRef = useRef(null);

  const activeFolders = useMemo(() => fileFolders.filter((item) => !item.deletedAt), [fileFolders]);
  const activeAssets = useMemo(() => fileAssets.filter((item) => !item.deletedAt), [fileAssets]);
  const trashedFolders = useMemo(() => fileFolders.filter((item) => item.deletedAt), [fileFolders]);
  const trashedAssets = useMemo(() => fileAssets.filter((item) => item.deletedAt), [fileAssets]);
  const currentFolder = activeFolders.find((item) => item.id === currentFolderId) || null;
  const currentPath = currentFolder ? buildFolderPath(currentFolder, activeFolders) : "";
  const currentFolderParentId = currentFolder?.parentId || "";
  const currentUserId = session.currentUser?.uid || session.currentUser?.email || "local";

  useEffect(() => {
    if (currentFolderId && !activeFolders.some((item) => item.id === currentFolderId)) {
      setCurrentFolderId("");
    }
  }, [activeFolders, currentFolderId]);

  useEffect(() => {
    if (currentSection === "trash") {
      setShowSidebar(false);
    }
  }, [currentSection]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!lightboxDragging) return undefined;

    function handlePointerMove(event) {
      const drag = lightboxDragRef.current;
      if (!drag) return;
      setLightboxOffset({
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY)
      });
    }

    function handlePointerUp() {
      lightboxDragRef.current = null;
      setLightboxDragging(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [lightboxDragging]);

  useEffect(() => {
    function handlePointerDown(event) {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".files-card-toolbar, .files-item-menu, .files-trash-actions")) {
        return;
      }
      setMenuState(null);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!showQrModal || !qrSession?.accessLink) {
      setQrCodeUrl("");
      return undefined;
    }

    let cancelled = false;
    QRCode.toDataURL(qrSession.accessLink, {
      width: 280,
      margin: 1,
      color: {
        dark: "#f8fafc",
        light: "#101826"
      }
    })
      .then((url) => {
        if (!cancelled) {
          setQrCodeUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrCodeUrl("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [qrSession?.accessLink, showQrModal]);

  useEffect(() => {
    if (!showQrModal || !qrSession) return undefined;
    const timer = window.setInterval(() => {
      setQrSession((current) => {
        if (!current) return current;
        const expiresAt = new Date(current.expiresAt || 0).getTime();
        if (Number.isNaN(expiresAt)) return current;
        return {
          ...current,
          remainingMs: Math.max(0, expiresAt - Date.now()),
          isExpired: current.status !== "ATIVA" || expiresAt <= Date.now()
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [qrSession, showQrModal]);

  const breadcrumbs = useMemo(() => {
    if (!currentFolder) return [{ id: "", label: "Meu drive" }];
    const byId = new Map(activeFolders.map((item) => [item.id, item]));
    const items = [];
    let cursor = currentFolder;
    while (cursor) {
      items.unshift({ id: cursor.id, label: cursor.name });
      cursor = cursor.parentId ? byId.get(cursor.parentId) || null : null;
    }
    return [{ id: "", label: "Meu drive" }, ...items];
  }, [activeFolders, currentFolder]);

  const currentFolders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return activeFolders
      .filter((item) => String(item.parentId || "") === currentFolderId)
      .filter((item) => {
        if (!query) return true;
        return (
          String(item.name || "").toLowerCase().includes(query) ||
          String(item.description || "").toLowerCase().includes(query)
        );
      });
  }, [activeFolders, currentFolderId, searchQuery]);

  const currentAssets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return activeAssets
      .filter((item) => String(item.folderId || "") === currentFolderId)
      .filter((item) => {
        if (!query) return true;
        return (
          String(item.title || "").toLowerCase().includes(query) ||
          String(item.notes || "").toLowerCase().includes(query)
        );
      });
  }, [activeAssets, currentFolderId, searchQuery]);

  const trashFoldersView = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return trashedFolders.filter(
      (item) =>
        !query ||
        String(item.name || "").toLowerCase().includes(query) ||
        String(item.description || "").toLowerCase().includes(query)
    );
  }, [trashedFolders, searchQuery]);

  const trashAssetsView = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return trashedAssets.filter(
      (item) =>
        !query ||
        String(item.title || "").toLowerCase().includes(query) ||
        String(item.notes || "").toLowerCase().includes(query)
    );
  }, [trashedAssets, searchQuery]);

  const visibleAssets = currentSection === "trash" ? trashAssetsView : currentAssets;
  const lightboxAssets = useMemo(
    () => visibleAssets.filter((item) => item.fileType === "image"),
    [visibleAssets]
  );
  const selectedAsset = visibleAssets.find((item) => item.id === selectedAssetId) || null;
  const selectedAssets = currentAssets.filter((item) => selectedAssetIds.includes(item.id));
  const digitizedCount = activeAssets.filter((item) => item.digitized).length;
  const lightboxIndex = useMemo(
    () => lightboxAssets.findIndex((item) => item.id === lightboxAsset?.id),
    [lightboxAsset?.id, lightboxAssets]
  );
  const hasPreviousLightboxAsset = lightboxIndex > 0;
  const hasNextLightboxAsset = lightboxIndex >= 0 && lightboxIndex < lightboxAssets.length - 1;
  const moveTargets = useMemo(() => {
    const excluded =
      moveModal?.type === "folder" ? [moveModal.folderId, ...getDescendantIds(activeFolders, moveModal.folderId)] : [];
    return [{ id: "", label: "Meu drive" }].concat(
      activeFolders
        .filter((item) => !excluded.includes(item.id))
        .map((item) => ({ id: item.id, label: buildFolderPath(item, activeFolders) }))
    );
  }, [activeFolders, moveModal]);

  useEffect(() => {
    if (!lightboxAsset) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setLightboxAsset(null);
        return;
      }
      if (event.key === "ArrowLeft" && hasPreviousLightboxAsset) {
        event.preventDefault();
        openLightboxByIndex(lightboxIndex - 1);
      }
      if (event.key === "ArrowRight" && hasNextLightboxAsset) {
        event.preventDefault();
        openLightboxByIndex(lightboxIndex + 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasNextLightboxAsset, hasPreviousLightboxAsset, lightboxAsset, lightboxIndex]);

  useEffect(() => {
    if (currentSection !== "trash" && !currentAssets.length) {
      setSelectedAssetId("");
      setSelectedAssetIds([]);
      return;
    }
    if (currentSection === "trash" && !trashAssetsView.length) {
      setSelectedAssetId("");
      return;
    }
    if (currentSection === "trash") {
      if (!trashAssetsView.some((item) => item.id === selectedAssetId)) {
        setSelectedAssetId(trashAssetsView[0]?.id || "");
      }
      return;
    }
    if (!currentAssets.some((item) => item.id === selectedAssetId)) {
      setSelectedAssetId(currentAssets[0]?.id || "");
    }
    setSelectedAssetIds((current) => current.filter((id) => currentAssets.some((item) => item.id === id)));
  }, [currentAssets, currentSection, selectedAssetId, trashAssetsView]);

  function showSuccess(message) {
    setFeedbackType("success");
    setFeedback(message);
  }

  function showError(error) {
    setFeedbackType("error");
    setFeedback(error?.message || "Nao foi possivel concluir esta acao.");
  }

  function toggleAssetSelection(assetId) {
    setSelectedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]
    );
    setSelectedAssetId(assetId);
  }

  function resetLightboxView() {
    setLightboxZoom(1);
    setLightboxOffset({ x: 0, y: 0 });
    lightboxDragRef.current = null;
    setLightboxDragging(false);
  }

  function openLightboxAssetByRecord(asset) {
    setLightboxAsset(asset);
    setSelectedAssetId(asset.id);
    resetLightboxView();
  }

  function openLightboxByIndex(index) {
    const nextAsset = lightboxAssets[index];
    if (!nextAsset) return;
    openLightboxAssetByRecord(nextAsset);
  }

  function handleFileChosen(files) {
    if (!files?.length) return;
    setSelectedFiles(files);
    setUploadForm((current) => ({
      ...current,
      title: files.length === 1 ? current.title || getDefaultTitle(files[0]) : ""
    }));
  }

  async function handleCreateFolder(event) {
    event.preventDefault();
    try {
      await actions.createFileFolder({
        ...folderForm,
        parentId: currentSection === "drive" ? currentFolderId : "",
        createdBy: currentUserId
      });
      setFolderForm({ name: "", description: "" });
      setShowCreateFolderModal(false);
      showSuccess("Pasta criada com sucesso.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!selectedFiles.length) {
      showError(new Error("Selecione ao menos um arquivo."));
      return;
    }
    setUploading(true);
    try {
      for (const file of selectedFiles) {
        await actions.uploadFileAsset({
          file,
          folderId: currentFolderId,
          folderPath: currentPath,
          title: selectedFiles.length === 1 ? uploadForm.title || getDefaultTitle(file) : getDefaultTitle(file),
          notes: uploadForm.notes,
          uploadedBy: currentUserId
        });
      }
      setSelectedFiles([]);
      setUploadForm({ title: "", notes: "" });
      setShowUploadModal(false);
      showSuccess(selectedFiles.length > 1 ? "Arquivos enviados com sucesso." : "Arquivo enviado com sucesso.");
    } catch (error) {
      showError(error);
    } finally {
      setUploading(false);
    }
  }

  async function handleRename(event) {
    event.preventDefault();
    if (!renameModal) return;
    try {
      if (renameModal.type === "folder") {
        await actions.renameFileFolder(renameModal.id, renameModal.value);
      } else {
        await actions.renameFileAsset(renameModal.id, renameModal.value);
      }
      setRenameModal(null);
      showSuccess("Nome atualizado com sucesso.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleMove(event) {
    event.preventDefault();
    if (!moveModal) return;
    try {
      if (moveModal.type === "folder") {
        await actions.moveFileFolder(moveModal.folderId, moveModal.targetId, activeFolders);
      } else {
        await actions.moveFileAssets(moveModal.assetIds, moveModal.targetId);
        setSelectedAssetIds([]);
      }
      setMoveModal(null);
      showSuccess("Item movido com sucesso.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleTrashAsset(assetId) {
    if (!window.confirm("Enviar este arquivo para a lixeira?")) return;
    try {
      await actions.trashFileAssets([assetId]);
      setSelectedAssetIds((current) => current.filter((id) => id !== assetId));
      setSelectedAssetId("");
      showSuccess("Arquivo enviado para a lixeira.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleTrashSelected() {
    if (!selectedAssetIds.length) return;
    if (!window.confirm(`Enviar ${selectedAssetIds.length} arquivo(s) para a lixeira?`)) return;
    try {
      await actions.trashFileAssets(selectedAssetIds);
      setSelectedAssetIds([]);
      setSelectedAssetId("");
      showSuccess("Arquivos enviados para a lixeira.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleTrashFolder(folderId) {
    if (!window.confirm("Enviar esta pasta e o conteudo dela para a lixeira?")) return;
    try {
      await actions.trashFileFolder(folderId, activeFolders, activeAssets);
      if (folderId === currentFolderId) {
        setCurrentFolderId(currentFolderParentId);
      }
      showSuccess("Pasta enviada para a lixeira.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleRestoreAsset(assetId) {
    try {
      await actions.restoreFileAssets([assetId]);
      showSuccess("Arquivo restaurado.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleRestoreFolder(folderId) {
    try {
      await actions.restoreFileFolder(folderId, fileFolders, fileAssets);
      showSuccess("Pasta restaurada.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleDeleteAssetForever(assetId) {
    if (!window.confirm("Excluir este arquivo definitivamente? Esta acao nao pode ser desfeita.")) return;
    try {
      await actions.deleteFileAssets([assetId]);
      setSelectedAssetId("");
      showSuccess("Arquivo excluido definitivamente.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleDeleteFolderForever(folderId) {
    if (!window.confirm("Excluir esta pasta definitivamente? Todo o conteudo interno sera removido e esta acao nao pode ser desfeita.")) {
      return;
    }
    try {
      await actions.deleteFileFolder(folderId, fileFolders, fileAssets);
      setSelectedAssetId("");
      showSuccess("Pasta excluida definitivamente.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleToggleDigitized(asset) {
    try {
      await actions.toggleFileDigitized(asset.id, !asset.digitized);
      showSuccess(asset.digitized ? "Arquivo marcado como pendente no ACMS." : "Arquivo marcado como digitado no ACMS.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleDownloadAsset(asset) {
    try {
      await downloadAsset(asset);
    } catch (error) {
      showError(error);
    }
  }

  async function openDriveUploadQr(folder, { regenerate = false } = {}) {
    if (!folder?.id) return;
    setQrLoading(true);
    setQrFolder(folder);
    setShowQrModal(true);
    try {
      const nextSession = await actions.createDriveUploadSession(
        {
          id: folder.id,
          name: folder.name,
          path: buildFolderPath(folder, activeFolders)
        },
        currentUserId,
        { regenerate }
      );
      setQrSession(nextSession);
      if (regenerate) {
        showSuccess("Novo QR temporario gerado para esta pasta.");
      }
    } catch (error) {
      showError(error);
      setShowQrModal(false);
      setQrFolder(null);
      setQrSession(null);
    } finally {
      setQrLoading(false);
    }
  }

  async function handleCloseQrSession() {
    if (!qrSession?.id) return;
    if (!window.confirm("Encerrar este acesso temporario agora?")) return;
    try {
      await actions.closeDriveUploadSession(qrSession.id);
      setQrSession((current) =>
        current
          ? {
              ...current,
              status: "ENCERRADA",
              remainingMs: 0,
              isExpired: true
            }
          : current
      );
      showSuccess("Acesso temporario encerrado.");
    } catch (error) {
      showError(error);
    }
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      showSuccess(successMessage);
    } catch (error) {
      showError(new Error("Nao foi possivel copiar automaticamente. Copie manualmente."));
    }
  }

  function openRenameFolder(folder) {
    setRenameModal({ type: "folder", id: folder.id, value: folder.name });
  }

  function openRenameAsset(asset) {
    setRenameModal({ type: "asset", id: asset.id, value: asset.title });
  }

  function openMoveFolder(folder) {
    setMoveModal({ type: "folder", folderId: folder.id, targetId: folder.parentId || "" });
  }

  function openMoveAssets(assetIds) {
    if (!assetIds.length) return;
    setMoveModal({ type: "assets", assetIds, targetId: currentFolderId });
  }

  function handleLightboxPointerDown(event) {
    if (!lightboxAsset) return;
    event.preventDefault();
    lightboxDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: lightboxOffset.x,
      originY: lightboxOffset.y
    };
    setLightboxDragging(true);
  }

  function handleLightboxWheel(event) {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.15 : -0.15;
    setLightboxZoom((current) => Math.min(4, Math.max(0.5, Number((current + delta).toFixed(2)))));
  }

  function resetLightboxZoom() {
    resetLightboxView();
  }

  function openAsset(asset) {
    setSelectedAssetId(asset.id);
    if (asset.fileType === "image") {
      openLightboxAssetByRecord(asset);
      return;
    }
    window.open(asset.secureUrl, "_blank", "noopener,noreferrer");
  }

  function openItemMenu(event, payload) {
    event.preventDefault();
    event.stopPropagation();
    setMenuState((current) => (current?.key === payload.key ? null : payload));
  }

  function runMenuAction(callback) {
    setMenuState(null);
    callback();
  }

  function renderItemMenu(key, items) {
    if (menuState?.key !== key) return null;
    return (
      <div className="files-item-menu" onClick={(event) => event.stopPropagation()}>
        {items.map((item) => (
          <button
            key={`${key}-${item.label}`}
            type="button"
            className={`files-item-menu-action ${item.variant ? `is-${item.variant}` : ""}`}
            onClick={() => runMenuAction(item.onClick)}
          >
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    );
  }

  function renderFolderCard(folder) {
    const menuItems = [
      { icon: "edit", label: "Renomear", onClick: () => openRenameFolder(folder) },
      { icon: "move", label: "Mover", onClick: () => openMoveFolder(folder) },
      { icon: "qr", label: "QR para enviar arquivos", onClick: () => openDriveUploadQr(folder) },
      { icon: "trash", label: "Enviar para lixeira", variant: "danger", onClick: () => handleTrashFolder(folder.id) }
    ];
    return (
      <article
        key={folder.id}
        className={`files-drive-card files-folder-card ${viewMode === "list" ? "is-list" : ""}`}
        onContextMenu={(event) => openItemMenu(event, { key: `folder-${folder.id}` })}
      >
        <div className="files-card-toolbar">
          <button
            type="button"
            className="files-card-menu-button"
            onClick={(event) => openItemMenu(event, { key: `folder-${folder.id}` })}
          >
            <Icon name="more" size={18} />
          </button>
          {renderItemMenu(`folder-${folder.id}`, menuItems)}
        </div>
        <button
          type="button"
          className="files-drive-card-preview files-folder-preview"
          onClick={() => {
            setCurrentFolderId(folder.id);
            setSelectedAssetIds([]);
          }}
        >
          <div className="files-folder-icon files-folder-preview-icon">
            <Icon name="folder" size={32} />
          </div>
        </button>
        <div className="files-drive-card-copy">
          <strong>{folder.name}</strong>
          <p>{folder.description || "Subpasta do gerenciador de arquivos."}</p>
          <span>{formatDate(folder.createdAt)}</span>
        </div>
      </article>
    );
  }

  function renderAssetCard(asset) {
    const menuItems = [
      {
        icon: asset.digitized ? "refresh" : "check",
        label: asset.digitized ? "Voltar para pendente" : "Marcar digitada",
        variant: asset.digitized ? "success" : "",
        onClick: () => handleToggleDigitized(asset)
      },
      { icon: "edit", label: "Renomear", onClick: () => openRenameAsset(asset) },
      { icon: "move", label: "Mover", onClick: () => openMoveAssets([asset.id]) },
      { icon: "download", label: "Baixar", onClick: () => handleDownloadAsset(asset) },
      { icon: "trash", label: "Enviar para lixeira", variant: "danger", onClick: () => handleTrashAsset(asset.id) }
    ];
    return (
      <article
        key={asset.id}
        className={`files-drive-card ${viewMode === "list" ? "is-list" : ""} ${
          selectedAssetId === asset.id ? "is-active" : ""
        }`}
        onContextMenu={(event) => openItemMenu(event, { key: `asset-${asset.id}` })}
      >
        <div className="files-card-select-wrap">
          <button
            type="button"
            className={`files-card-select ${selectedAssetIds.includes(asset.id) ? "is-active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleAssetSelection(asset.id);
            }}
          >
            <Icon name="check" size={16} />
          </button>
        </div>
        <div className="files-card-toolbar">
          <button
            type="button"
            className="files-card-menu-button"
            onClick={(event) => openItemMenu(event, { key: `asset-${asset.id}` })}
          >
            <Icon name="more" size={18} />
          </button>
          {renderItemMenu(`asset-${asset.id}`, menuItems)}
        </div>
        <button
          type="button"
          className="files-drive-card-preview"
          onClick={() => openAsset(asset)}
        >
          {asset.fileType === "image" ? (
            <img src={asset.thumbnailUrl || asset.secureUrl} alt={asset.title} />
          ) : (
            <div className="files-drive-card-pdf">
              <Icon name="fileText" size={32} />
            </div>
          )}
        </button>
        <div className="files-drive-card-copy" onClick={() => setSelectedAssetId(asset.id)}>
          <div className="files-card-flags">
            <span className={`files-flag ${asset.digitized ? "is-success" : "is-warning"}`}>
              {asset.digitized ? "Digitada no ACMS" : "Pendente no ACMS"}
            </span>
          </div>
          <strong>{asset.title}</strong>
          <p>{asset.notes || `${formatAssetTypeLabel(asset)} salvo no drive.`}</p>
          <span>
            {formatAssetTypeLabel(asset)} • {formatDate(asset.createdAt)}
          </span>
        </div>
      </article>
    );
  }

  const emptyDrive = !currentFolders.length && !currentAssets.length;
  const emptyTrash = !trashFoldersView.length && !trashAssetsView.length;

  return (
    <div className="files-drive-shell">
      {feedback ? (
        <div className={`files-toast ${feedbackType === "error" ? "is-error" : "is-success"}`}>
          <div>
            <strong>{feedbackType === "error" ? "Nao foi possivel concluir" : "Tudo certo"}</strong>
            <p>{feedback}</p>
          </div>
          <button type="button" className="files-toast-close" onClick={() => setFeedback("")}>
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : null}

      {showSidebar ? <button type="button" className="files-sidebar-backdrop is-open" onClick={() => setShowSidebar(false)} /> : null}

      <aside className={`files-drive-sidebar ${showSidebar ? "is-open" : ""}`}>
        <div className="files-drive-brand">
          <div className="brand-mark">AC</div>
          <div>
            <strong>Meu drive</strong>
            <span>{session.currentUser?.displayName || "Tesouraria"}</span>
          </div>
          <button type="button" className="files-sidebar-close" onClick={() => setShowSidebar(false)}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="files-drive-nav">
          <button
            type="button"
            className={`files-drive-nav-item ${currentSection === "drive" ? "is-active" : ""}`}
            onClick={() => {
              setCurrentSection("drive");
              setShowSidebar(false);
            }}
          >
            <Icon name="folder" size={18} />
            <span>Meu drive</span>
          </button>
          <button
            type="button"
            className={`files-drive-nav-item ${currentSection === "trash" ? "is-active" : ""}`}
            onClick={() => {
              setCurrentSection("trash");
              setSelectedAssetIds([]);
              setShowSidebar(false);
            }}
          >
            <Icon name="trash" size={18} />
            <span>Lixeira</span>
          </button>
          <Link className="files-drive-nav-item" to="/app">
            <Icon name="arrowLeft" size={18} />
            <span>Voltar ao painel</span>
          </Link>
        </div>

        <div className="files-folder-rail">
          <div className="files-section-title">
            <h3>Resumo rapido</h3>
            <p>Arquivos, status ACMS e itens na lixeira.</p>
          </div>
          <div className="files-folder-list">
            <div className="files-folder-tile is-active">
              <div className="files-folder-tile-top">
                <div className="files-folder-icon">
                  <Icon name="folder" size={18} />
                </div>
                <span>{activeFolders.length} pastas</span>
              </div>
              <strong>{activeAssets.length} arquivos ativos</strong>
              <p>{digitizedCount} digitados no ACMS</p>
            </div>
            <div className="files-folder-tile">
              <div className="files-folder-tile-top">
                <div className="files-folder-icon">
                  <Icon name="trash" size={18} />
                </div>
                <span>{trashedFolders.length + trashedAssets.length} itens</span>
              </div>
              <strong>Lixeira protegida</strong>
              <p>Os itens podem ser restaurados depois.</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="files-drive-main">
        <section className="files-drive-topbar">
          <div>
            <span className="eyebrow">Gerenciador de arquivos</span>
            <h1>{currentSection === "trash" ? "Lixeira" : "Meu drive"}</h1>
            <p>Organize notas, comprovantes e imagens como um app de arquivos, com controle ACMS.</p>
          </div>
          <div className="files-drive-actions">
            <button type="button" className="button-ghost files-mobile-menu" onClick={() => setShowSidebar(true)}>
              <Icon name="list" size={18} />
              <span>Menu</span>
            </button>
            <div className="files-section-switch">
              <button
                type="button"
                className={`files-view-button ${currentSection === "drive" ? "is-active" : ""}`}
                onClick={() => setCurrentSection("drive")}
              >
                <Icon name="folder" size={16} />
                <span>Drive</span>
              </button>
              <button
                type="button"
                className={`files-view-button ${currentSection === "trash" ? "is-active" : ""}`}
                onClick={() => setCurrentSection("trash")}
              >
                <Icon name="trash" size={16} />
                <span>Lixeira</span>
              </button>
            </div>
            <label className="field files-drive-search">
              <span>Buscar</span>
              <div className="search-input">
                <Icon name="search" size={18} />
                <input
                  type="search"
                  placeholder={currentSection === "trash" ? "Buscar na lixeira" : "Buscar nome ou observacao"}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
            </label>
            {currentSection === "drive" ? (
              <>
                <button type="button" className="button-ghost" onClick={() => setShowCreateFolderModal(true)}>
                  <Icon name="folder" size={18} />
                  <span>Nova pasta</span>
                </button>
                <button type="button" className="button-primary" onClick={() => setShowUploadModal(true)}>
                  <Icon name="upload" size={18} />
                  <span>Criar ou carregar</span>
                </button>
              </>
            ) : null}
            <div className="files-view-toggle">
              <button
                type="button"
                className={`files-view-button ${viewMode === "grid" ? "is-active" : ""}`}
                onClick={() => setViewMode("grid")}
              >
                <Icon name="grid" size={16} />
                <span>Miniaturas</span>
              </button>
              <button
                type="button"
                className={`files-view-button ${viewMode === "list" ? "is-active" : ""}`}
                onClick={() => setViewMode("list")}
              >
                <Icon name="list" size={16} />
                <span>Lista</span>
              </button>
            </div>
          </div>
        </section>

        <section className="files-drive-summary files-drive-summary-compact">
          <StatPill icon="folder" label="Pastas ativas" value={activeFolders.length} />
          <StatPill icon="fileText" label="Arquivos" value={activeAssets.length} />
          <StatPill icon="check" label="Digitadas no ACMS" value={digitizedCount} />
          <StatPill icon="trash" label="Na lixeira" value={trashedFolders.length + trashedAssets.length} />
        </section>

        <div className="files-workspace">
          <section className="files-browser-panel">
            <div className="files-library-card">
              <div className="files-library-top">
                <div className="files-section-title">
                  <h3>{currentSection === "trash" ? "Itens da lixeira" : currentFolder ? currentFolder.name : "Meu drive"}</h3>
                  <p>
                    {currentSection === "trash"
                      ? "Restaure o que ainda precisa voltar para o fluxo."
                      : currentFolder
                        ? `Caminho atual: ${currentPath}`
                        : "Abra pastas e subpastas como um gerenciador de arquivos."}
                  </p>
                </div>
                <div className="files-library-meta">
                  {currentSection === "drive" && selectedAssetIds.length ? (
                    <span className="files-selection-badge">{selectedAssetIds.length} selecionado(s)</span>
                  ) : null}
                </div>
              </div>

              {currentSection === "drive" ? (
                <>
                  <div className="files-current-actions actions-row">
                    {currentFolder ? (
                      <button type="button" className="button-ghost" onClick={() => setCurrentFolderId(currentFolderParentId)}>
                        <Icon name="arrowLeft" size={18} />
                        <span>Voltar</span>
                      </button>
                    ) : null}
                    <div className="files-breadcrumbs">
                      {breadcrumbs.map((item, index) => (
                        <button key={`${item.id || "root"}-${index}`} type="button" onClick={() => setCurrentFolderId(item.id)}>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedAssetIds.length > 1 ? (
                    <div className="files-inspector-card files-current-actions">
                      <div className="files-section-title">
                        <h3>Selecao em lote</h3>
                        <p>Mova ou envie varios arquivos para a lixeira de uma so vez.</p>
                      </div>
                      <div className="files-inspector-actions">
                        <ActionChip icon="move" label="Mover selecionados" onClick={() => openMoveAssets(selectedAssetIds)} />
                        <ActionChip icon="trash" label="Enviar para lixeira" variant="danger" onClick={handleTrashSelected} />
                      </div>
                    </div>
                  ) : null}

                  {emptyDrive ? (
                    <div className="files-inspector-card files-empty-inspector">
                      <div className="files-section-title">
                        <h3>Nada nesta pasta ainda</h3>
                        <p>Crie uma pasta ou envie imagens e PDFs para começar a organizar o drive.</p>
                      </div>
                    </div>
                  ) : (
                    <div className={`files-drive-grid ${viewMode === "list" ? "is-list" : ""}`}>
                      {currentFolders.map((folder) => renderFolderCard(folder))}
                      {currentAssets.map((asset) => renderAssetCard(asset))}
                    </div>
                  )}
                </>
              ) : emptyTrash ? (
                <div className="files-inspector-card files-empty-inspector">
                  <div className="files-section-title">
                    <h3>Lixeira vazia</h3>
                    <p>Os itens apagados aparecem aqui e podem ser restaurados a qualquer momento.</p>
                  </div>
                </div>
              ) : (
                <div className="files-trash-list">
                  {trashFoldersView.map((folder) => (
                    <article
                      key={folder.id}
                      className="files-trash-row"
                      onContextMenu={(event) => openItemMenu(event, { key: `trash-folder-${folder.id}` })}
                    >
                      <div className="files-trash-copy">
                        <div className="files-folder-icon">
                          <Icon name="folder" size={18} />
                        </div>
                        <div>
                          <strong>{folder.name}</strong>
                          <p>{folder.description || "Pasta movida para a lixeira."}</p>
                          <span>{formatDate(folder.deletedAt)}</span>
                        </div>
                      </div>
                      <div className="files-trash-actions">
                        <button
                          type="button"
                          className="files-card-menu-button"
                          onClick={(event) => openItemMenu(event, { key: `trash-folder-${folder.id}` })}
                        >
                          <Icon name="more" size={18} />
                        </button>
                        {renderItemMenu(`trash-folder-${folder.id}`, [
                          { icon: "restore", label: "Restaurar pasta", variant: "success", onClick: () => handleRestoreFolder(folder.id) },
                          { icon: "trash", label: "Excluir definitivamente", variant: "danger", onClick: () => handleDeleteFolderForever(folder.id) }
                        ])}
                      </div>
                    </article>
                  ))}
                  {trashAssetsView.map((asset) => (
                    <article
                      key={asset.id}
                      className="files-trash-row"
                      onContextMenu={(event) => openItemMenu(event, { key: `trash-asset-${asset.id}` })}
                    >
                      <div className="files-trash-copy">
                        <div className="files-folder-icon">
                          <Icon name={asset.fileType === "image" ? "image" : "fileText"} size={18} />
                        </div>
                        <div>
                          <strong>{asset.title}</strong>
                          <p>{asset.notes || `${formatAssetTypeLabel(asset)} movido para a lixeira.`}</p>
                          <span>{formatDate(asset.deletedAt)}</span>
                        </div>
                      </div>
                      <div className="files-trash-actions">
                        <button
                          type="button"
                          className="files-card-menu-button"
                          onClick={(event) => openItemMenu(event, { key: `trash-asset-${asset.id}` })}
                        >
                          <Icon name="more" size={18} />
                        </button>
                        {renderItemMenu(`trash-asset-${asset.id}`, [
                          { icon: "download", label: "Baixar", onClick: () => handleDownloadAsset(asset) },
                          { icon: "restore", label: "Restaurar arquivo", variant: "success", onClick: () => handleRestoreAsset(asset.id) },
                          { icon: "trash", label: "Excluir definitivamente", variant: "danger", onClick: () => handleDeleteAssetForever(asset.id) }
                        ])}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="files-inspector">
            {currentSection === "trash" ? (
              <div className="files-inspector-card">
                <div className="files-section-title">
                  <h3>Painel da lixeira</h3>
                  <p>Revise o que foi removido logicamente antes de restaurar.</p>
                </div>
                <div className="files-inspector-meta">
                  <div>
                    <span>Pastas</span>
                    <strong>{trashedFolders.length}</strong>
                  </div>
                  <div>
                    <span>Arquivos</span>
                    <strong>{trashedAssets.length}</strong>
                  </div>
                </div>
                <p className="helper-text danger-text">Use restaurar para devolver ao drive ou excluir definitivamente para remover do app e do Firebase.</p>
              </div>
            ) : selectedAssetIds.length > 1 ? (
              <div className="files-inspector-card">
                <div className="files-section-title">
                  <h3>{selectedAssetIds.length} arquivos selecionados</h3>
                  <p>Use as acoes em lote para reorganizar ou limpar o drive.</p>
                </div>
                <div className="files-inspector-actions">
                  <ActionChip icon="move" label="Mover" onClick={() => openMoveAssets(selectedAssetIds)} />
                  <ActionChip icon="trash" label="Lixeira" variant="danger" onClick={handleTrashSelected} />
                </div>
                <div className="files-multi-selection-list">
                  {selectedAssets.map((asset) => (
                    <div key={asset.id} className="files-multi-selection-item">
                      <div className="files-multi-selection-icon">
                        <Icon name={asset.fileType === "image" ? "image" : "fileText"} size={18} />
                      </div>
                      <div>
                        <strong>{asset.title}</strong>
                        <p>{asset.digitized ? "Digitada no ACMS" : "Pendente no ACMS"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : selectedAsset ? (
              <div className="files-inspector-card">
                <div className="files-section-title">
                  <h3>{selectedAsset.title}</h3>
                  <p>{selectedAsset.notes || "Arquivo pronto para consulta e controle do ACMS."}</p>
                </div>
                <div className="files-inspector-preview">
                  {selectedAsset.fileType === "image" ? (
                    <button type="button" className="files-image-open-button" onClick={() => openAsset(selectedAsset)}>
                      <img className="files-preview-image" src={selectedAsset.thumbnailUrl || selectedAsset.secureUrl} alt={selectedAsset.title} />
                    </button>
                  ) : (
                    <div className="files-pdf-preview">
                      <Icon name="fileText" size={42} />
                      <strong>PDF pronto para abrir</strong>
                      <button type="button" className="button-ghost" onClick={() => openAsset(selectedAsset)}>
                        Abrir documento
                      </button>
                    </div>
                  )}
                </div>
                <div className="files-card-flags">
                  <span className={`files-flag ${selectedAsset.digitized ? "is-success" : "is-warning"}`}>
                    {selectedAsset.digitized ? "Digitada no ACMS" : "Pendente no ACMS"}
                  </span>
                </div>
                <div className="files-inspector-actions">
                  <ActionChip
                    icon={selectedAsset.digitized ? "refresh" : "check"}
                    label={selectedAsset.digitized ? "Voltar para pendente" : "Marcar digitada"}
                    variant={selectedAsset.digitized ? "success" : "default"}
                    onClick={() => handleToggleDigitized(selectedAsset)}
                  />
                  <ActionChip icon="edit" label="Renomear" onClick={() => openRenameAsset(selectedAsset)} />
                  <ActionChip icon="move" label="Mover" onClick={() => openMoveAssets([selectedAsset.id])} />
                  <ActionChip icon="download" label="Baixar" onClick={() => handleDownloadAsset(selectedAsset)} />
                  <ActionChip icon="trash" label="Lixeira" variant="danger" onClick={() => handleTrashAsset(selectedAsset.id)} />
                </div>
                <div className="files-inspector-meta">
                  <div>
                    <span>Tipo</span>
                    <strong>{formatAssetTypeLabel(selectedAsset)}</strong>
                  </div>
                  <div>
                    <span>Data</span>
                    <strong>{formatDate(selectedAsset.createdAt)}</strong>
                  </div>
                  <div>
                    <span>Pasta</span>
                    <strong>{activeFolders.find((item) => item.id === selectedAsset.folderId)?.name || "Meu drive"}</strong>
                  </div>
                  <div>
                    <span>Digitada em</span>
                    <strong>{selectedAsset.digitizedAt ? formatDate(selectedAsset.digitizedAt) : "Ainda nao"}</strong>
                  </div>
                </div>
              </div>
            ) : (
              <div className="files-inspector-card">
                <div className="files-section-title">
                  <h3>{currentFolder ? currentFolder.name : "Raiz do drive"}</h3>
                  <p>
                    {currentFolder
                      ? currentFolder.description || "Pasta atual do gerenciador."
                      : "Aqui ficam as pastas principais e os arquivos soltos do drive."}
                  </p>
                </div>
                <div className="files-inspector-meta">
                  <div>
                    <span>Subpastas</span>
                    <strong>{currentFolders.length}</strong>
                  </div>
                  <div>
                    <span>Arquivos</span>
                    <strong>{currentAssets.length}</strong>
                  </div>
                  <div>
                    <span>Caminho</span>
                    <strong>{currentPath || "Meu drive"}</strong>
                  </div>
                  <div>
                    <span>Criada em</span>
                    <strong>{currentFolder ? formatDate(currentFolder.createdAt) : "-"}</strong>
                  </div>
                </div>
                {currentFolder ? (
                  <div className="files-inspector-actions">
                    <ActionChip icon="edit" label="Renomear pasta" onClick={() => openRenameFolder(currentFolder)} />
                    <ActionChip icon="move" label="Mover pasta" onClick={() => openMoveFolder(currentFolder)} />
                    <ActionChip icon="qr" label="QR de envio" onClick={() => openDriveUploadQr(currentFolder)} />
                    <ActionChip icon="trash" label="Lixeira" variant="danger" onClick={() => handleTrashFolder(currentFolder.id)} />
                  </div>
                ) : null}
              </div>
            )}
          </aside>
        </div>
      </main>

      {showQrModal ? (
        <div
          className="files-modal-backdrop files-qr-backdrop"
          onClick={() => {
            setShowQrModal(false);
            setQrFolder(null);
            setQrSession(null);
          }}
        >
          <div className="files-modal-card files-qr-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="files-qr-close"
              onClick={() => {
                setShowQrModal(false);
                setQrFolder(null);
                setQrSession(null);
              }}
            >
              <Icon name="close" size={18} />
            </button>
            <div className="files-qr-header">
              <span className="files-qr-badge">Enviar do celular</span>
              <h3>QR temporario para upload</h3>
              <p>
                Escaneie para enviar arquivos diretamente para <strong>{qrFolder?.name || qrSession?.folderName || "esta pasta"}</strong>.
              </p>
            </div>

            {qrLoading ? (
              <div className="files-empty-state">
                <Icon name="qr" size={28} />
                <strong>Gerando acesso temporario...</strong>
                <p>Estamos preparando o QR, o codigo e o link desta pasta.</p>
              </div>
            ) : qrSession ? (
              <div className="files-qr-layout">
                <div className="files-qr-copy">
                  <div className="files-qr-instructions">
                    <strong>Como usar</strong>
                    <p>Abra a camera do celular, aponte para o QR e depois digite o codigo curto para liberar o envio.</p>
                    <ul className="files-selected-file-list">
                      <li>Esse acesso so envia para esta pasta.</li>
                      <li>A sessao expira apos 30 minutos sem atividade.</li>
                      <li>No celular, sera possivel apagar e renomear apenas os arquivos dessa sessao.</li>
                    </ul>
                  </div>
                  <div className="files-qr-code-box">
                    {qrCodeUrl ? <img src={qrCodeUrl} alt={`QR para enviar arquivos a ${qrSession.folderName}`} /> : <span>QR indisponivel</span>}
                  </div>
                  <div className="files-qr-code-value">
                    <span>Codigo de acesso</span>
                    <strong>{qrSession.accessCode || "------"}</strong>
                  </div>
                  <div className="files-qr-meta">
                    <div>
                      <span>Link temporario</span>
                      <strong>{qrSession.accessLink}</strong>
                    </div>
                    <div>
                      <span>Tempo restante</span>
                      <strong>{Math.max(0, Math.floor((qrSession.remainingMs || 0) / 60000))} min</strong>
                    </div>
                  </div>
                </div>

                <div className="files-qr-actions">
                  <button type="button" className="button-primary" onClick={() => window.open(qrSession.accessLink, "_blank", "noopener,noreferrer")}>
                    <Icon name="upload" size={18} />
                    <span>Acessar aqui</span>
                  </button>
                  <button type="button" className="button-ghost" onClick={() => copyText(qrSession.accessLink, "Link temporario copiado.")}>
                    <Icon name="download" size={18} />
                    <span>Copiar link</span>
                  </button>
                  <button type="button" className="button-ghost" onClick={() => copyText(qrSession.accessCode || "", "Codigo de acesso copiado.")}>
                    <Icon name="lock" size={18} />
                    <span>Copiar codigo</span>
                  </button>
                  <button
                    type="button"
                    className="button-ghost"
                    onClick={() =>
                      openDriveUploadQr(
                        qrFolder || { id: qrSession.folderId, name: qrSession.folderName, path: qrSession.folderPath },
                        { regenerate: true }
                      )
                    }
                  >
                    <Icon name="refresh" size={18} />
                    <span>Gerar novo QR</span>
                  </button>
                  <button type="button" className="button-ghost danger-text" onClick={handleCloseQrSession}>
                    <Icon name="close" size={18} />
                    <span>Encerrar acesso</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showCreateFolderModal ? (
        <div className="files-modal-backdrop" onClick={() => setShowCreateFolderModal(false)}>
          <div className="files-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="files-section-title">
              <h3>Nova pasta</h3>
              <p>{currentPath ? `Criando dentro de ${currentPath}` : "Crie uma pasta na raiz do drive."}</p>
            </div>
            <form className="panel-form" onSubmit={handleCreateFolder}>
              <label className="field">
                <span>Nome da pasta</span>
                <input
                  type="text"
                  value={folderForm.name}
                  onChange={(event) => setFolderForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Ex: Notas de abril"
                  autoFocus
                />
              </label>
              <label className="field">
                <span>Observacao</span>
                <textarea
                  rows={3}
                  value={folderForm.description}
                  onChange={(event) => setFolderForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Opcional"
                />
              </label>
              <div className="actions-row">
                <button type="submit" className="button-primary">Salvar pasta</button>
                <button type="button" className="button-ghost" onClick={() => setShowCreateFolderModal(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showUploadModal ? (
        <div className="files-modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div className="files-modal-card files-upload-modal" onClick={(event) => event.stopPropagation()}>
            <div className="files-section-title">
              <h3>Criar ou carregar</h3>
              <p>{currentPath ? `Os arquivos vao para ${currentPath}.` : "Os arquivos vao para a raiz do drive."}</p>
            </div>
            <input
              ref={cameraInputRef}
              className="sr-only-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => handleFileChosen(Array.from(event.target.files || []))}
            />
            <input
              ref={fileInputRef}
              className="sr-only-input"
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(event) => handleFileChosen(Array.from(event.target.files || []))}
            />
            <form className="panel-form" onSubmit={handleUpload}>
              <div className="files-upload-inline-actions">
                <button type="button" className="button-ghost" onClick={() => cameraInputRef.current?.click()}>
                  <Icon name="camera" size={18} />
                  <span>Tirar foto</span>
                </button>
                <button type="button" className="button-ghost" onClick={() => fileInputRef.current?.click()}>
                  <Icon name="upload" size={18} />
                  <span>Escolher arquivos</span>
                </button>
              </div>

              {selectedFiles.length ? (
                <div className="files-file-banner">
                  <strong>{selectedFiles.length > 1 ? `${selectedFiles.length} arquivos prontos` : "Arquivo pronto"}</strong>
                  <p>Imagens serao compactadas levemente. PDFs vao sem compactacao.</p>
                  <ul className="files-selected-file-list">
                    {selectedFiles.map((file) => (
                      <li key={`${file.name}-${file.size}`}>{file.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selectedFiles.length === 1 ? (
                <label className="field">
                  <span>Nome do arquivo</span>
                  <input
                    type="text"
                    value={uploadForm.title}
                    onChange={(event) => setUploadForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Titulo do arquivo"
                  />
                </label>
              ) : null}

              <label className="field">
                <span>Observacao</span>
                <textarea
                  rows={3}
                  value={uploadForm.notes}
                  onChange={(event) => setUploadForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Opcional. Vale para todos os arquivos selecionados."
                />
              </label>

              <div className="actions-row">
                <button type="submit" className="button-primary" disabled={uploading}>
                  {uploading ? "Enviando..." : "Enviar arquivos"}
                </button>
                <button type="button" className="button-ghost" onClick={() => setShowUploadModal(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {renameModal ? (
        <div className="files-modal-backdrop" onClick={() => setRenameModal(null)}>
          <div className="files-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="files-section-title">
              <h3>{renameModal.type === "folder" ? "Renomear pasta" : "Renomear arquivo"}</h3>
              <p>Atualize o nome para organizar melhor o drive.</p>
            </div>
            <form className="panel-form" onSubmit={handleRename}>
              <label className="field">
                <span>Novo nome</span>
                <input
                  type="text"
                  value={renameModal.value}
                  onChange={(event) => setRenameModal((current) => ({ ...current, value: event.target.value }))}
                  autoFocus
                />
              </label>
              <div className="actions-row">
                <button type="submit" className="button-primary">Salvar nome</button>
                <button type="button" className="button-ghost" onClick={() => setRenameModal(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {moveModal ? (
        <div className="files-modal-backdrop" onClick={() => setMoveModal(null)}>
          <div className="files-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="files-section-title">
              <h3>{moveModal.type === "folder" ? "Mover pasta" : "Mover arquivo(s)"}</h3>
              <p>Escolha a pasta de destino dentro do seu drive.</p>
            </div>
            <form className="panel-form" onSubmit={handleMove}>
              <label className="field">
                <span>Destino</span>
                <select
                  value={moveModal.targetId}
                  onChange={(event) => setMoveModal((current) => ({ ...current, targetId: event.target.value }))}
                >
                  {moveTargets.map((target) => (
                    <option key={target.id || "root"} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="actions-row">
                <button type="submit" className="button-primary">Mover agora</button>
                <button type="button" className="button-ghost" onClick={() => setMoveModal(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {lightboxAsset ? (
        <div className="files-modal-backdrop" onClick={() => setLightboxAsset(null)}>
          <div className="files-lightbox" onClick={(event) => event.stopPropagation()}>
            <div className="files-lightbox-top">
              <div>
                <strong>{lightboxAsset.title}</strong>
                <p>{lightboxAsset.notes || "Visualizador de imagem com zoom."}</p>
                <span className="files-lightbox-count">
                  {lightboxIndex >= 0 ? `${lightboxIndex + 1} de ${lightboxAssets.length}` : `1 de ${lightboxAssets.length || 1}`}
                </span>
              </div>
              <div className="files-lightbox-actions">
                <ActionChip
                  icon={lightboxAsset.digitized ? "refresh" : "check"}
                  label={lightboxAsset.digitized ? "Voltar pendente" : "Marcar digitada"}
                  variant={lightboxAsset.digitized ? "success" : "default"}
                  onClick={() => handleToggleDigitized(lightboxAsset)}
                />
                <ActionChip
                  icon="arrowLeft"
                  label="Anterior"
                  onClick={() => openLightboxByIndex(lightboxIndex - 1)}
                />
                <ActionChip
                  icon="chevron"
                  label="Proxima"
                  onClick={() => openLightboxByIndex(lightboxIndex + 1)}
                />
                <ActionChip icon="zoomOut" label="Zoom -" onClick={() => setLightboxZoom((current) => Math.max(0.5, current - 0.25))} />
                <ActionChip icon="zoomIn" label="Zoom +" onClick={() => setLightboxZoom((current) => Math.min(3, current + 0.25))} />
                <ActionChip icon="grid" label="Ajustar" onClick={() => setLightboxOffset({ x: 0, y: 0 })} />
                <ActionChip icon="refresh" label="Reset" onClick={resetLightboxZoom} />
                <ActionChip icon="download" label="Baixar" onClick={() => handleDownloadAsset(lightboxAsset)} />
                <ActionChip icon="close" label="Fechar" onClick={() => setLightboxAsset(null)} />
              </div>
            </div>
            <div className="files-lightbox-image-wrap" onWheel={handleLightboxWheel}>
              <button
                type="button"
                className="files-lightbox-nav files-lightbox-nav-left"
                onClick={() => openLightboxByIndex(lightboxIndex - 1)}
                disabled={!hasPreviousLightboxAsset}
              >
                <Icon name="arrowLeft" size={18} />
              </button>
              <img
                className="files-lightbox-image"
                src={lightboxAsset.secureUrl}
                alt={lightboxAsset.title}
                onPointerDown={handleLightboxPointerDown}
                style={{
                  transform: `translate(${lightboxOffset.x}px, ${lightboxOffset.y}px) scale(${lightboxZoom})`,
                  transformOrigin: "center center",
                  cursor: lightboxDragging ? "grabbing" : "grab"
                }}
              />
              <button
                type="button"
                className="files-lightbox-nav files-lightbox-nav-right"
                onClick={() => openLightboxByIndex(lightboxIndex + 1)}
                disabled={!hasNextLightboxAsset}
              >
                <Icon name="chevron" size={18} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {currentSection === "drive" ? (
        <button type="button" className="files-floating-upload" onClick={() => setShowUploadModal(true)}>
          <Icon name="upload" size={22} />
        </button>
      ) : null}
    </div>
  );
}
