import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { apagarTudo } from "../backup/snapshot";
import {
  AcaoBloqueada,
  aplicarContagem,
  excluirApontamento,
  excluirCompra,
  excluirComponente,
  gerarPedidos,
  lancarMovimento,
  salvarApontamento,
  salvarCompra,
  salvarComponente,
  salvarLote,
  salvarProduto,
} from "./acoes";
import { db } from "./db";
import { calcularSaldos } from "./estoque";
import { inventarioEm, movimentacaoNoPeriodo, custosDosLotes, pendenciasFiscais, type BaseDados } from "./relatorios";
import type { Componente } from "./tipos";

const base: Omit<Componente, "id" | "criadoEm" | "nome"> = {
  categoria: "Geral",
  unidade: "un",
  estoqueMinimo: 0,
  modoCobranca: "unidade",
  controlaEstoque: true,
  ativo: true,
};

async function saldo(id: string) {
  return calcularSaldos(await db.movimentos.toArray()).get(id) ?? { quantidade: 0, custoMedio: 0, valor: 0 };
}

async function carregarBase(): Promise<BaseDados> {
  const [fornecedores, componentes, componenteFornecedores, produtos, composicoes, composicaoItens, movimentos, compras, compraItens, lotes, loteItens, custosFabricacao, apontamentos] =
    await Promise.all([
      db.fornecedores.toArray(),
      db.componentes.toArray(),
      db.componenteFornecedores.toArray(),
      db.produtos.toArray(),
      db.composicoes.toArray(),
      db.composicaoItens.toArray(),
      db.movimentos.toArray(),
      db.compras.toArray(),
      db.compraItens.toArray(),
      db.lotes.toArray(),
      db.loteItens.toArray(),
      db.custosFabricacao.toArray(),
      db.apontamentos.toArray(),
    ]);
  return {
    empresa: { nome: "X", cnpj: "", regime: "", dataTransicao: "" },
    fornecedores,
    componentes,
    componenteFornecedores,
    produtos,
    composicoes,
    composicaoItens,
    movimentos,
    compras,
    compraItens,
    lotes,
    loteItens,
    custosFabricacao,
    apontamentos,
    anexosPorRef: new Map(),
  };
}

beforeEach(async () => {
  await apagarTudo();
});

const compraBase = {
  data: "2026-09-01T12:00:00.000Z",
  documentoTipo: "nfe" as const,
  compradoEm: "cnpj" as const,
  frete: 20,
  impostos: 0,
  outrasDespesas: 0,
  moeda: "BRL" as const,
};

describe("compras no estoque", () => {
  it("receber a compra dá entrada com frete no custo; editar e excluir refazem o estoque", async () => {
    const sw = await salvarComponente({ ...base, nome: "Chave" }, []);
    const id = await salvarCompra({ ...compraBase, status: "pedido" }, [{ componenteId: sw, quantidade: 10, valorTotal: 80, qtdRecebida: 0 }]);
    expect((await saldo(sw)).quantidade).toBe(0);

    const itens = await db.compraItens.where("compraId").equals(id).toArray();
    await salvarCompra({ ...compraBase, id, status: "recebida" }, itens);
    expect((await saldo(sw)).quantidade).toBe(10);
    expect((await saldo(sw)).custoMedio).toBeCloseTo(10); // (80 + 20) / 10

    await salvarCompra({ ...compraBase, id, status: "recebida" }, [{ ...itens[0], quantidade: 5, valorTotal: 80 }]);
    expect((await saldo(sw)).quantidade).toBe(5);
    expect(await db.movimentos.count()).toBe(1);

    await excluirCompra(id);
    expect(await db.movimentos.count()).toBe(0);
    expect(await db.compraItens.count()).toBe(0);
  });

  it("não exclui componente com histórico", async () => {
    const sw = await salvarComponente({ ...base, nome: "Chave" }, []);
    await lancarMovimento({ componenteId: sw, tipo: "ajuste", quantidade: 3, custoUnitario: 2, data: "2026-09-01T12:00:00.000Z" });
    await expect(excluirComponente(sw)).rejects.toBeInstanceOf(AcaoBloqueada);
  });
});

describe("contagem física", () => {
  it("gera ajustes só para as diferenças, como saldo inicial na transição", async () => {
    const a = await salvarComponente({ ...base, nome: "A", custoReferencia: 4 }, []);
    const b = await salvarComponente({ ...base, nome: "B" }, []);
    await lancarMovimento({ componenteId: b, tipo: "ajuste", quantidade: 5, custoUnitario: 1, data: "2026-09-01T12:00:00.000Z" });
    const r = await aplicarContagem("2026-09-30", [
      { componenteId: a, contado: 7 },
      { componenteId: b, contado: 5 },
    ], true);
    expect(r.ajustes).toBe(1);
    expect((await saldo(a)).quantidade).toBe(7);
    expect((await saldo(a)).custoMedio).toBe(4); // sem custo médio, usa o de referência
    expect((await db.movimentos.toArray()).find((m) => m.componenteId === a)?.tipo).toBe("saldo_inicial");
  });

  it("na transição, o saldo importado depois da data é substituído e não conta duas vezes", async () => {
    const a = await salvarComponente({ ...base, nome: "A" }, []);
    await db.movimentos.put({ id: "imp", data: "2026-10-20T12:00:00.000Z", componenteId: a, tipo: "saldo_inicial", quantidade: 10, custoUnitario: 3, refTipo: "importacao" });
    await aplicarContagem("2026-10-01", [{ componenteId: a, contado: 8 }], true);
    const s = await saldo(a);
    expect(s.quantidade).toBe(8);
    expect(s.custoMedio).toBe(3); // aproveita o custo que veio do app antigo
    expect(await db.movimentos.get("imp")).toBeUndefined();
  });
});

describe("produtos", () => {
  it("cria versão nova da composição só quando a lista de peças muda", async () => {
    const sw = await salvarComponente({ ...base, nome: "Chave" }, []);
    const r1 = await salvarProduto({ nome: "8SW", precoVenda: 100, tipo: "fabricacao", ativo: true }, [{ componenteId: sw, quantidade: 8 }]);
    expect(r1.novaVersao).toBe(1);
    const p = (await db.produtos.get(r1.id))!;
    const r2 = await salvarProduto({ ...p, precoVenda: 120 }, [{ componenteId: sw, quantidade: 8 }]);
    expect(r2.novaVersao).toBeUndefined();
    const r3 = await salvarProduto({ ...p }, [{ componenteId: sw, quantidade: 6 }]);
    expect(r3.novaVersao).toBe(2);
    expect(await db.composicoes.count()).toBe(2);
  });
});

describe("lote do começo ao fim", () => {
  it("pedidos, produção, baixa de peças, mão de obra e custo real", async () => {
    const sw = await salvarComponente({ ...base, nome: "Chave" }, []);
    const pcb = await salvarComponente({ ...base, nome: "PCB", modoCobranca: "modelo" }, []);
    const { id: prod } = await salvarProduto({ nome: "8SW", precoVenda: 100, tipo: "fabricacao", ativo: true }, [
      { componenteId: sw, quantidade: 8 },
      { componenteId: pcb, quantidade: 1 },
    ]);
    const lote = await salvarLote({ codigo: "L-001", status: "planejado", margemSobra: 0 }, [{ produtoId: prod, qtdPlanejada: 2 }]);
    const [pedido] = await gerarPedidos(lote, [
      { componenteId: sw, quantidade: 16, precoUnitario: 2 },
      { componenteId: pcb, quantidade: 1, precoUnitario: 50 },
    ], "2026-09-01T12:00:00.000Z");
    expect((await db.lotes.get(lote))!.status).toBe("comprando");

    const compra = (await db.compras.get(pedido))!;
    const itens = await db.compraItens.where("compraId").equals(pedido).toArray();
    await salvarCompra({ ...compra, status: "recebida" }, itens);

    const ap = await salvarApontamento({ loteId: lote, produtoId: prod, data: "2026-09-05T12:00:00.000Z", qtdBoa: 2, qtdRefugo: 0, horas: 3 }, 40);
    expect((await db.lotes.get(lote))!.status).toBe("em_producao");
    expect((await saldo(sw)).quantidade).toBe(0);
    expect((await saldo(pcb)).quantidade).toBe(0);
    expect((await db.loteItens.where("loteId").equals(lote).first())!.qtdProduzida).toBe(2);

    const custo = custosDosLotes(await carregarBase()).get(lote)!;
    expect(custo.materiais).toBeCloseTo(82);
    expect(custo.maoDeObra).toBeCloseTo(120);
    expect(custo.porPedal).toBeCloseTo(101);

    await excluirApontamento(ap);
    expect((await saldo(sw)).quantidade).toBe(16);
    expect(await db.custosFabricacao.count()).toBe(0);
    expect((await db.loteItens.where("loteId").equals(lote).first())!.qtdProduzida).toBeNull();
  });
});

describe("relatórios", () => {
  it("movimentação do período e inventário fecham com o livro", async () => {
    const sw = await salvarComponente({ ...base, nome: "Chave" }, []);
    await lancarMovimento({ componenteId: sw, tipo: "saldo_inicial", quantidade: 10, custoUnitario: 2, data: "2026-08-15T12:00:00.000Z" });
    await lancarMovimento({ componenteId: sw, tipo: "ajuste", quantidade: 10, custoUnitario: 4, data: "2026-09-10T12:00:00.000Z" });
    await lancarMovimento({ componenteId: sw, tipo: "perda", quantidade: -5, data: "2026-09-20T12:00:00.000Z" });
    const b = await carregarBase();
    const mov = movimentacaoNoPeriodo(b, "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z");
    const l = mov.linhas[0];
    expect(l.inicial).toEqual({ quantidade: 10, valor: 20 });
    expect(l.entradas.valor).toBeCloseTo(40);
    expect(l.saidas.valor).toBeCloseTo(15);
    expect(l.final.valor).toBeCloseTo(45);
    expect(inventarioEm(b, "2026-08-31T23:59:59.999Z").total).toBeCloseTo(20);
    expect(inventarioEm(b, "2026-09-30T23:59:59.999Z").total).toBeCloseTo(45);
  });

  it("aponta pendências fiscais", async () => {
    const sw = await salvarComponente({ ...base, nome: "Chave" }, []);
    await salvarCompra({ ...compraBase, status: "recebida", documentoTipo: "sem_documento", compradoEm: "cpf" }, [{ componenteId: sw, quantidade: 1, valorTotal: 1, qtdRecebida: 1 }]);
    const ids = pendenciasFiscais(await carregarBase()).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["empresa", "sem-doc", "cpf", "ncm", "origem"]));
  });
});

describe("correções da revisão", () => {
  it("contagem de transição só substitui o saldo importado das peças contadas", async () => {
    const a = await salvarComponente({ ...base, nome: "A" }, []);
    const b = await salvarComponente({ ...base, nome: "B" }, []);
    for (const [id, q] of [[a, 10], [b, 50]] as const)
      await db.movimentos.put({ id: `imp_${id}`, data: "2026-10-20T12:00:00.000Z", componenteId: id, tipo: "saldo_inicial", quantidade: q, custoUnitario: 2, refTipo: "importacao" });
    await aplicarContagem("2026-10-01", [{ componenteId: a, contado: 8 }], true);
    expect((await saldo(a)).quantidade).toBe(8);
    expect((await saldo(b)).quantidade).toBe(50);
  });

  it("contagem sem diferenças fica registrada e resolve a pendência da transição", async () => {
    const a = await salvarComponente({ ...base, nome: "A" }, []);
    await lancarMovimento({ componenteId: a, tipo: "ajuste", quantidade: 5, custoUnitario: 1, data: "2026-09-01T12:00:00.000Z" });
    const r = await aplicarContagem("2026-10-01", [{ componenteId: a, contado: 5 }], true);
    expect(r.ajustes).toBe(0);
    const b = await carregarBase();
    b.contagens = ((await db.config.get("contagens"))?.valor as BaseDados["contagens"]) ?? [];
    b.empresa = { ...b.empresa, dataTransicao: "2026-10-01" };
    expect(pendenciasFiscais(b).map((p) => p.id)).not.toContain("contagem");
  });

  it("a mesma NF-e não entra duas vezes", async () => {
    const sw = await salvarComponente({ ...base, nome: "Chave" }, []);
    const chave = "35260912345678000195550010000012341000123454";
    await salvarCompra({ ...compraBase, status: "recebida", chaveNFe: chave }, [{ componenteId: sw, quantidade: 1, valorTotal: 1, qtdRecebida: 1 }]);
    await expect(salvarCompra({ ...compraBase, status: "recebida", chaveNFe: chave }, [{ componenteId: sw, quantidade: 1, valorTotal: 1, qtdRecebida: 1 }])).rejects.toBeInstanceOf(AcaoBloqueada);
  });

  it("editar o lote não apaga modelo já produzido nem refaz a produção com a composição nova", async () => {
    const sw = await salvarComponente({ ...base, nome: "Chave" }, []);
    await lancarMovimento({ componenteId: sw, tipo: "ajuste", quantidade: 100, custoUnitario: 1, data: "2026-09-01T12:00:00.000Z" });
    const { id: p8 } = await salvarProduto({ nome: "8SW", precoVenda: 0, tipo: "fabricacao", ativo: true }, [{ componenteId: sw, quantidade: 8 }]);
    const { id: pn } = await salvarProduto({ nome: "NANO", precoVenda: 0, tipo: "fabricacao", ativo: true }, [{ componenteId: sw, quantidade: 6 }]);
    const lote = await salvarLote({ codigo: "L-001", status: "planejado", margemSobra: 0 }, [{ produtoId: p8, qtdPlanejada: 2 }]);
    await salvarApontamento({ loteId: lote, produtoId: p8, data: "2026-09-05T12:00:00.000Z", qtdBoa: 2, qtdRefugo: 0 }, 0);
    const p8atual = (await db.produtos.get(p8))!;
    await salvarProduto(p8atual, [{ componenteId: sw, quantidade: 10 }]); // composição v2
    await salvarLote({ ...(await db.lotes.get(lote))! }, [{ produtoId: pn, qtdPlanejada: 1 }]); // tira o 8SW do plano
    await salvarApontamento({ loteId: lote, produtoId: pn, data: "2026-09-06T12:00:00.000Z", qtdBoa: 1, qtdRefugo: 0 }, 0);
    expect((await saldo(sw)).quantidade).toBe(100 - 16 - 6);
    const item8 = (await db.loteItens.where("loteId").equals(lote).toArray()).find((i) => i.produtoId === p8)!;
    expect(item8).toMatchObject({ qtdPlanejada: 0, qtdProduzida: 2 });
  });

  it("editar um registro antigo mantém o valor da hora da época", async () => {
    const sw = await salvarComponente({ ...base, nome: "Chave" }, []);
    const { id: p8 } = await salvarProduto({ nome: "8SW", precoVenda: 0, tipo: "fabricacao", ativo: true }, [{ componenteId: sw, quantidade: 1 }]);
    const lote = await salvarLote({ codigo: "L-001", status: "planejado", margemSobra: 0 }, [{ produtoId: p8, qtdPlanejada: 2 }]);
    const ap = await salvarApontamento({ loteId: lote, produtoId: p8, data: "2026-09-05T12:00:00.000Z", qtdBoa: 1, qtdRefugo: 0, horas: 2 }, 50);
    await salvarApontamento({ ...(await db.apontamentos.get(ap))!, obs: "corrigido" }, 0);
    expect((await db.custosFabricacao.toArray())[0].valor).toBe(100);
    await salvarApontamento({ ...(await db.apontamentos.get(ap))!, horas: 3 }, 80);
    expect((await db.custosFabricacao.toArray())[0].valor).toBe(150);
  });
});
