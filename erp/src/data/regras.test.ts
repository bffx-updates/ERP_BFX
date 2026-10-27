import { describe, expect, it } from "vitest";
import { custosDeEntrada, movimentosDaCompra, quantidadeAReceber } from "./compras";
import { livroDeEstoque } from "./estoque";
import { chaveNFeValida, cnpjValido, cpfValido, formatarDocumento, lerNumero, limitesDoMes, mesLocal, paraEntrada } from "./formato";
import { movimentosDeConsumo, necessidadesDoLote, proximoCodigoDeLote } from "./lotes";
import type { Apontamento, Componente, Compra, CompraItem, ComposicaoItem, Movimento, Produto } from "./tipos";

const comp = (id: string, extra: Partial<Componente> = {}): Componente => ({
  id,
  nome: id,
  categoria: "Geral",
  unidade: "un",
  estoqueMinimo: 0,
  modoCobranca: "unidade",
  controlaEstoque: true,
  ativo: true,
  criadoEm: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe("números digitados", () => {
  it("entende vírgula e ponto do jeito brasileiro", () => {
    expect(lerNumero("1.234,56")).toBe(1234.56);
    expect(lerNumero("1234,5")).toBe(1234.5);
    expect(lerNumero("1234.5")).toBe(1234.5);
    expect(lerNumero("1.234")).toBe(1234);
    expect(lerNumero("R$ 12,90")).toBe(12.9);
    expect(lerNumero("0.500")).toBe(0.5);
    expect(lerNumero("-1.234")).toBe(-1234);
    expect(lerNumero("")).toBeNull();
    expect(lerNumero("abc")).toBeNull();
  });

  it("devolve para o campo com vírgula", () => {
    expect(paraEntrada(12.5, 2)).toBe("12,50");
    expect(paraEntrada(0.333333333)).toBe("0,333333");
  });

  it("calcula os limites do mês", () => {
    expect(limitesDoMes("2026-02")).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(limitesDoMes("2028-02").ate).toBe("2028-02-29");
  });
});

describe("documentos", () => {
  it("valida CNPJ, CPF e chave da NF-e", () => {
    expect(cnpjValido("12.345.678/0001-95")).toBe(true);
    expect(cnpjValido("12.345.678/0001-96")).toBe(false);
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(chaveNFeValida("35260912345678000195550010000012341000123454")).toBe(true);
    expect(chaveNFeValida("35260912345678000195550010000012341000123455")).toBe(false);
  });

  it("aceita o CNPJ alfanumérico (exemplo oficial da Receita: 12.ABC.345/01DE-35)", () => {
    expect(cnpjValido("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjValido("12abc34501de35")).toBe(true);
    expect(cnpjValido("12.ABC.345/01DE-36")).toBe(false);
    expect(formatarDocumento("12abc34501de35")).toBe("12.ABC.345/01DE-35");
  });

  it("o mês de uma data é o do fuso local", () => {
    // 31/10 23:59:59 em São Paulo é 01/11 02:59:59 em UTC.
    expect(mesLocal(new Date(2026, 9, 31, 23, 59, 59).toISOString())).toBe("2026-10");
  });
});

describe("custo de entrada das compras", () => {
  const compra: Compra = {
    id: "c1",
    data: "2026-09-01T12:00:00.000Z",
    status: "recebida",
    documentoTipo: "nfe",
    compradoEm: "cnpj",
    frete: 30,
    impostos: 10,
    outrasDespesas: 0,
    moeda: "BRL",
  };
  const itens: CompraItem[] = [
    { id: "i1", compraId: "c1", componenteId: "a", quantidade: 10, valorTotal: 100, qtdRecebida: 10 },
    { id: "i2", compraId: "c1", componenteId: "b", quantidade: 2, valorTotal: 300, qtdRecebida: 2 },
  ];

  it("rateia frete e impostos pelo valor de cada item", () => {
    const c = custosDeEntrada(compra, itens);
    expect(c.get("i1")!.rateio).toBeCloseTo(10);
    expect(c.get("i1")!.custoUnitario).toBeCloseTo(11);
    expect(c.get("i2")!.custoUnitario).toBeCloseTo(165);
  });

  it("gera entrada no estoque só quando recebida e só de peças estocáveis", () => {
    const componentes = new Map([
      ["a", comp("a")],
      ["b", comp("b", { controlaEstoque: false })],
    ]);
    expect(movimentosDaCompra({ ...compra, status: "pedido" }, itens, componentes)).toHaveLength(0);
    const movs = movimentosDaCompra(compra, itens, componentes);
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ componenteId: "a", quantidade: 10, tipo: "entrada_compra", refId: "c1" });
    expect(movs[0].custoUnitario).toBeCloseTo(11);
    expect(movimentosDaCompra({ ...compra, legado: true }, itens, componentes)).toHaveLength(0);
  });

  it("recebimento parcial entra só com o que chegou e o resto fica a receber", () => {
    const parcial = { ...compra, status: "recebida_parcial" as const };
    const itensParciais = [{ ...itens[0], qtdRecebida: 4 }];
    const movs = movimentosDaCompra(parcial, itensParciais, new Map([["a", comp("a")]]));
    expect(movs[0].quantidade).toBe(4);
    expect(quantidadeAReceber(parcial, itensParciais[0])).toBe(6);
  });
});

describe("livro de estoque", () => {
  it("guarda o custo de cada saída pelo custo médio da hora", () => {
    const movs: Movimento[] = [
      { id: "1", data: "2026-01-01", componenteId: "a", tipo: "entrada_compra", quantidade: 10, custoUnitario: 2 },
      { id: "2", data: "2026-01-02", componenteId: "a", tipo: "consumo_producao", quantidade: -4 },
      { id: "3", data: "2026-01-03", componenteId: "a", tipo: "entrada_compra", quantidade: 6, custoUnitario: 4 },
    ];
    const livro = livroDeEstoque(movs);
    expect(livro[1].valor).toBeCloseTo(-8);
    expect(livro[2].custoMedio).toBeCloseTo(3);
    expect(livro[2].saldoValor).toBeCloseTo(36);
  });

  it("na mesma data, a entrada vem antes da saída", () => {
    const movs: Movimento[] = [
      { id: "z", data: "2026-01-01", componenteId: "a", tipo: "consumo_producao", quantidade: -1 },
      { id: "a", data: "2026-01-01", componenteId: "a", tipo: "entrada_compra", quantidade: 1, custoUnitario: 5 },
    ];
    const livro = livroDeEstoque(movs);
    expect(livro[0].movimento.quantidade).toBe(1);
    expect(livro[1].valor).toBe(-5);
  });
});

describe("lotes", () => {
  const produtos = new Map<string, Produto>([
    ["p8", { id: "p8", nome: "8SW", precoVenda: 0, tipo: "fabricacao", composicaoAtualId: "v8", ativo: true, criadoEm: "" }],
    ["pn", { id: "pn", nome: "NANO", precoVenda: 0, tipo: "fabricacao", composicaoAtualId: "vn", ativo: true, criadoEm: "" }],
  ]);
  const componentes = new Map([
    ["sw", comp("sw")],
    ["pcb", comp("pcb", { modoCobranca: "modelo" })],
    ["stencil", comp("stencil", { modoCobranca: "lote" })],
    ["frete", comp("frete", { controlaEstoque: false })],
  ]);
  const composicaoItens: ComposicaoItem[] = [
    { id: "1", composicaoId: "v8", componenteId: "sw", quantidade: 8 },
    { id: "2", composicaoId: "v8", componenteId: "pcb", quantidade: 1 },
    { id: "3", composicaoId: "v8", componenteId: "stencil", quantidade: 1 },
    { id: "4", composicaoId: "v8", componenteId: "frete", quantidade: 1 },
    { id: "5", composicaoId: "vn", componenteId: "sw", quantidade: 6 },
    { id: "6", composicaoId: "vn", componenteId: "stencil", quantidade: 1 },
  ];

  it("calcula o que comprar com sobra, estoque e pedidos em aberto", () => {
    const linhas = necessidadesDoLote({
      lote: { margemSobra: 10 },
      itens: [
        { produtoId: "p8", qtdPlanejada: 5 },
        { produtoId: "pn", qtdPlanejada: 2 },
      ],
      produtos,
      composicaoItens,
      componentes,
      saldos: new Map([["sw", 20]]),
      aReceber: new Map([["sw", 10]]),
      consumido: new Map(),
    });
    const sw = linhas.find((l) => l.componente.id === "sw")!;
    expect(sw.necessario).toBe(52);
    expect(sw.comSobra).toBe(58); // 52 × 1,1 = 57,2 → 58
    expect(sw.aComprar).toBe(28);
    expect(linhas.find((l) => l.componente.id === "pcb")!.comSobra).toBe(1);
    expect(linhas.find((l) => l.componente.id === "stencil")!.comSobra).toBe(1); // uma vez por lote
    expect(linhas.find((l) => l.componente.id === "frete")).toBeUndefined();
  });

  it("apontamentos baixam peças por unidade sempre e fixas só uma vez", () => {
    const ap = (id: string, data: string, produtoId: string, qtdBoa: number, qtdRefugo = 0): Apontamento => ({ id, loteId: "L", produtoId, data, qtdBoa, qtdRefugo });
    const movs = movimentosDeConsumo({
      lote: { id: "L", codigo: "L-001" },
      apontamentos: [ap("b", "2026-02-02", "p8", 2), ap("a", "2026-02-01", "p8", 2, 1), ap("c", "2026-02-03", "pn", 1)],
      itens: [{ produtoId: "p8" }, { produtoId: "pn" }],
      produtos,
      composicaoItens,
      componentes,
    });
    const soma = (id: string) => movs.filter((m) => m.componenteId === id).reduce((a, m) => a + m.quantidade, 0);
    expect(soma("sw")).toBe(-(8 * 5 + 6 * 1));
    expect(soma("pcb")).toBe(-1);
    expect(soma("stencil")).toBe(-1);
    expect(movs.find((m) => m.componenteId === "pcb")!.refId).toBe("a"); // o primeiro por data
    expect(soma("frete")).toBe(0);
  });

  it("sugere o próximo código", () => {
    expect(proximoCodigoDeLote(["L-001", "L-009", "X"])).toBe("L-010");
    expect(proximoCodigoDeLote([])).toBe("L-001");
  });
});
