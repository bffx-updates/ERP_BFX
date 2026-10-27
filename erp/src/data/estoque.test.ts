import { describe, expect, it } from "vitest";
import { calcularSaldos, capacidadeDeMontagem, situacao, type ItemMontagem } from "./estoque";
import type { Movimento } from "./tipos";

const mov = (data: string, quantidade: number, custoUnitario?: number, componenteId = "sw"): Movimento => ({
  id: `${componenteId}_${data}_${quantidade}`,
  data,
  componenteId,
  tipo: quantidade > 0 ? "entrada_compra" : "consumo_producao",
  quantidade,
  custoUnitario,
});

describe("calcularSaldos", () => {
  it("calcula o custo médio ponderado entre entradas", () => {
    const s = calcularSaldos([mov("2026-01-01", 10, 2), mov("2026-01-02", 30, 4)]).get("sw")!;
    expect(s.quantidade).toBe(40);
    expect(s.custoMedio).toBeCloseTo(3.5);
    expect(s.valor).toBeCloseTo(140);
  });

  it("saídas baixam a quantidade sem mudar a média", () => {
    const s = calcularSaldos([mov("2026-01-01", 10, 2), mov("2026-01-02", -4)]).get("sw")!;
    expect(s.quantidade).toBe(6);
    expect(s.custoMedio).toBe(2);
    expect(s.valor).toBe(12);
  });

  it("processa em ordem de data, não de inserção", () => {
    const s = calcularSaldos([mov("2026-01-03", -5), mov("2026-01-01", 10, 1), mov("2026-01-02", 10, 3)]).get("sw")!;
    expect(s.quantidade).toBe(15);
    expect(s.custoMedio).toBeCloseTo(2);
  });

  it("entrada sem custo usa o custo médio vigente (ex.: ajuste positivo)", () => {
    const s = calcularSaldos([mov("2026-01-01", 10, 5), mov("2026-01-02", 2)]).get("sw")!;
    expect(s.quantidade).toBe(12);
    expect(s.custoMedio).toBe(5);
  });

  it("depois de saldo negativo, a nova entrada define a média só com o que entrou", () => {
    const s = calcularSaldos([mov("2026-01-01", -3), mov("2026-01-02", 10, 7)]).get("sw")!;
    expect(s.quantidade).toBe(7);
    expect(s.custoMedio).toBe(7);
    expect(s.valor).toBe(49);
  });

  it("separa componentes", () => {
    const saldos = calcularSaldos([mov("2026-01-01", 1, 1, "a"), mov("2026-01-01", 2, 2, "b")]);
    expect(saldos.get("a")!.quantidade).toBe(1);
    expect(saldos.get("b")!.valor).toBe(4);
  });
});

describe("capacidadeDeMontagem", () => {
  const item = (nome: string, quantidade: number, saldo: number, modo: ItemMontagem["modo"] = "unidade"): ItemMontagem => ({
    nome,
    quantidade,
    saldo,
    modo,
  });

  it("limita pela peça que acaba primeiro", () => {
    const c = capacidadeDeMontagem([item("Chave", 8, 35), item("Display", 1, 5), item("USB", 1, 9)]);
    expect(c.unidades).toBe(4);
    expect(c.limitantes.map((i) => i.nome)).toEqual(["Chave"]);
  });

  it("lista todas as peças empatadas no limite", () => {
    const c = capacidadeDeMontagem([item("PCB", 1, 0), item("Caixa", 1, 0), item("Display", 1, 5)]);
    expect(c.unidades).toBe(0);
    expect(c.limitantes.map((i) => i.nome)).toEqual(["PCB", "Caixa"]);
  });

  it("peça fixa por lote só precisa existir, sem dividir", () => {
    expect(capacidadeDeMontagem([item("Chave", 8, 80), item("Envelopes", 1, 1, "lote")]).unidades).toBe(10);
    const semEnvelope = capacidadeDeMontagem([item("Chave", 8, 80), item("Envelopes", 1, 0, "lote")]);
    expect(semEnvelope.unidades).toBe(0);
    expect(semEnvelope.limitantes[0].nome).toBe("Envelopes");
  });

  it("saldo negativo conta como zero e quantidades fracionadas funcionam", () => {
    expect(capacidadeDeMontagem([item("Fio", 0.5, 3), item("PCB", 1, -2)]).unidades).toBe(0);
    expect(capacidadeDeMontagem([item("Fio", 0.1, 0.3)]).unidades).toBe(3);
  });

  it("sem peças de estoque na composição não há como calcular", () => {
    expect(capacidadeDeMontagem([])).toEqual({ unidades: null, limitantes: [] });
    expect(capacidadeDeMontagem([item("Envelopes", 1, 5, "lote")]).unidades).toBeNull();
  });
});

describe("situacao", () => {
  it("classifica zerado, baixo e ok", () => {
    expect(situacao(0, 5)).toBe("zerado");
    expect(situacao(-1, 0)).toBe("zerado");
    expect(situacao(5, 5)).toBe("baixo");
    expect(situacao(6, 5)).toBe("ok");
    expect(situacao(1, 0)).toBe("ok");
  });
});
