import test from "node:test";
import assert from "node:assert/strict";
import {
  filterAdvances,
  getAdvancePersonKey,
  groupAdvancesByPerson,
  isAdvanceDueSoon,
  isAdvanceTrashEligible
} from "../src/utils/advanceView.js";

function advance(overrides = {}) {
  return {
    id: "a1",
    usuarioId: "user-1",
    usuarioNome: "Ana Lucia",
    descricao: "Material",
    valor: 100,
    totalComprovado: 20,
    dataAdiantamento: "2026-11-01T12:00:00.000Z",
    dataLimite: "2026-11-20T12:00:00.000Z",
    prazoDias: 15,
    status: "PENDENTE",
    lancadoAcms: false,
    ...overrides
  };
}

test("agrupa por usuarioId e soma valor e saldo sem duplicar registros", () => {
  const groups = groupAdvancesByPerson([
    advance({ id: "a1", valor: 100, totalComprovado: 20 }),
    advance({ id: "a2", valor: 50, totalComprovado: 50 }),
    advance({ id: "a3", usuarioId: "user-2", usuarioNome: "Joao", valor: 40, totalComprovado: 0 })
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].total, 150);
  assert.equal(groups[0].outstanding, 80);
});

test("usa nome normalizado quando o adiantamento nao possui usuarioId", () => {
  assert.equal(getAdvancePersonKey(advance({ usuarioId: "", usuarioNome: "Âna Lúcia" })), "nome:ana lucia");
  assert.equal(getAdvancePersonKey(advance({ usuarioId: "", usuarioNome: "ana lucia" })), "nome:ana lucia");
});

test("filtros podem combinar busca, status, ACMS e periodo", () => {
  const result = filterAdvances([
    advance({ id: "a1", dataAdiantamento: "2026-11-05T12:00:00.000Z" }),
    advance({ id: "a2", usuarioNome: "Joao", status: "ATRASADO", lancadoAcms: true, dataAdiantamento: "2026-10-01T12:00:00.000Z" })
  ], {
    query: "material",
    status: "PENDENTE",
    acms: "PENDENTE",
    from: "2026-11-01",
    to: "2026-11-30"
  });

  assert.deepEqual(result.map((item) => item.id), ["a1"]);
});

test("elegibilidade impede lixeira para prestado ou lancado no ACMS", () => {
  assert.equal(isAdvanceTrashEligible(advance()), true);
  assert.equal(isAdvanceTrashEligible(advance({ status: "PRESTADO", totalComprovado: 100 })), false);
  assert.equal(isAdvanceTrashEligible(advance({ lancadoAcms: true })), false);
  assert.equal(isAdvanceTrashEligible(advance({ deletedAt: "2026-11-10T00:00:00.000Z" })), false);
});

test("identifica adiantamento vencendo nos proximos sete dias", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  assert.equal(isAdvanceDueSoon(advance({ dataLimite: "2026-11-15T12:00:00.000Z" }), now), true);
  assert.equal(isAdvanceDueSoon(advance({ dataLimite: "2026-11-25T12:00:00.000Z" }), now), false);
});
