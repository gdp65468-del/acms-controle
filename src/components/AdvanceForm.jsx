import { useEffect, useMemo, useState } from "react";
import { computeDueDate, formatDate, toDateInputValue } from "../utils/format";

export function AdvanceForm({ users, advances, currentUser, onSave, onCreateMember, onDeleteMember }) {
  const members = useMemo(() => users.filter((item) => item.role === "member"), [users]);
  const [form, setForm] = useState({
    usuarioId: "",
    usuarioNome: "",
    publicToken: "",
    valor: "",
    dataAdiantamento: toDateInputValue(new Date().toISOString()),
    prazoDias: 15,
    descricao: ""
  });
  const [newMemberName, setNewMemberName] = useState("");
  const [error, setError] = useState("");
  const dueDate = computeDueDate(form.dataAdiantamento, form.prazoDias);

  useEffect(() => {
    if (!members.length) {
      setForm((current) => ({ ...current, usuarioId: "", usuarioNome: "" }));
      return;
    }

    const selectedMember = members.find((item) => item.id === form.usuarioId);
    if (selectedMember) {
      if (selectedMember.nome !== form.usuarioNome || (selectedMember.publicToken || "") !== form.publicToken) {
        setForm((current) => ({
          ...current,
          usuarioNome: selectedMember.nome,
          publicToken: selectedMember.publicToken || ""
        }));
      }
      return;
    }

    setForm((current) => ({
      ...current,
      usuarioId: members[0].id,
      usuarioNome: members[0].nome,
      publicToken: members[0].publicToken || ""
    }));
  }, [members, form.usuarioId, form.usuarioNome, form.publicToken]);

  function handleChange(field, value) {
    if (field === "usuarioId") {
      const member = members.find((item) => item.id === value);
      setForm((current) => ({
        ...current,
        usuarioId: value,
        usuarioNome: member?.nome || "",
        publicToken: member?.publicToken || ""
      }));
      return;
    }

    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreateMember() {
    const normalizedName = newMemberName.trim();
    if (!normalizedName) {
      setError("Digite o nome da pessoa antes de adicionar.");
      return;
    }

    try {
      setError("");
      const member = await onCreateMember({ nome: normalizedName });
      setForm((current) => ({
        ...current,
        usuarioId: member.id,
        usuarioNome: member.nome,
        publicToken: member.publicToken || ""
      }));
      setNewMemberName("");
    } catch (createError) {
      setError(createError.message);
    }
  }

  async function handleDeleteMember() {
    if (!form.usuarioId) return;
    const selectedMember = members.find((item) => item.id === form.usuarioId);
    if (!selectedMember) return;
    const confirmed = window.confirm(`Excluir o cadastro de ${selectedMember.nome}?`);
    if (!confirmed) return;
    try {
      setError("");
      await onDeleteMember(selectedMember);
      const nextMembers = members.filter((item) => item.id !== selectedMember.id);
      setForm((current) => ({
        ...current,
        usuarioId: nextMembers[0]?.id || "",
        usuarioNome: nextMembers[0]?.nome || "",
        publicToken: nextMembers[0]?.publicToken || ""
      }));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    try {
      await onSave({
        ...form,
        createdBy: currentUser.id,
        existingAdvances: advances
      });

      setForm((current) => ({
        ...current,
        valor: "",
        dataAdiantamento: toDateInputValue(new Date().toISOString()),
        prazoDias: 15,
        descricao: ""
      }));
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  return (
    <form className="panel form-grid section-panel" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <div>
          <h3>Novo adiantamento</h3>
          <p>Cadastre o valor, o responsavel e o prazo oficial.</p>
        </div>
      </div>

      <label>
        Responsavel
        <select value={form.usuarioId} onChange={(event) => handleChange("usuarioId", event.target.value)} required>
          {members.length ? (
            members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.nome}
              </option>
            ))
          ) : (
            <option value="">Nenhum responsavel cadastrado</option>
          )}
        </select>
      </label>

      <label>
        Novo responsavel
        <div className="inline-create-row">
          <input
            type="text"
            value={newMemberName}
            onChange={(event) => setNewMemberName(event.target.value)}
            placeholder="Digite o nome da pessoa"
          />
          <button className="button-ghost" type="button" onClick={handleCreateMember}>
            Adicionar
          </button>
          <button className="button-danger" type="button" onClick={handleDeleteMember} disabled={!form.usuarioId}>
            Excluir
          </button>
        </div>
      </label>

      <label>
        Valor
        <input
          type="number"
          min="0"
          step="0.01"
          value={form.valor}
          onChange={(event) => handleChange("valor", event.target.value)}
          required
        />
      </label>

      <label>
        Data do adiantamento
        <input
          type="date"
          value={form.dataAdiantamento}
          onChange={(event) => handleChange("dataAdiantamento", event.target.value)}
          required
        />
      </label>

      <label>
        Prazo
        <select value={form.prazoDias} onChange={(event) => handleChange("prazoDias", Number(event.target.value))}>
          <option value={15}>15 dias</option>
          <option value={30}>30 dias</option>
        </select>
      </label>

      <label className="full-span">
        Finalidade
        <textarea
          rows="3"
          value={form.descricao}
          onChange={(event) => handleChange("descricao", event.target.value)}
          placeholder="Ex.: compra de material para acao social"
          required
        />
      </label>

      <div className="deadline-box full-span">
        <span>Data limite automatica</span>
        <strong>{formatDate(dueDate)}</strong>
      </div>

      {error ? <p className="form-error full-span">{error}</p> : null}

      <div className="full-span actions-row">
        <button className="button-primary" type="submit" disabled={!form.usuarioId}>
          Salvar adiantamento
        </button>
      </div>
    </form>
  );
}
