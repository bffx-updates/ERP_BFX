import { describe, expect, it } from "vitest";
import { calcularSaldos } from "../data/estoque";
import { converterLegado, ehBackupLegado, IMAGEM_8SW, lerLegadoDoNavegador, type BackupLegado } from "./legado";

const AGORA = "2026-09-27T12:00:00.000Z";

function backupDeExemplo(): BackupLegado {
  return {
    db: {
      parts: {
        pcb_8sw: { name: "PCB 8SW+", cat: "Placa", price: 0, nolink: true },
        sw_spst: { name: "Chave SPST", cat: "Eletromecânica", price: 0, url: "https://pt.aliexpress.com/item/1.html" },
        usb_b: { name: "Conector USB-B", cat: "Conectores", price: 3, url: "https://www.mercadolivre.com.br/x" },
        cx_cor: { name: "Caixa Correio", cat: "Embalagem", price: 0, url: "https://www.rpcaixas.com.br/produtos/y" },
        frete: { name: "Frete DHL + imposto", cat: "Custos", price: 0, chargeMode: "model" },
        env: { name: "Envelope", cat: "Embalagem", price: 0, chargeMode: "lot" },
      },
      models: {
        m8swp: { name: "BFMiDi 8SW+", img: "8SW.png", salePrice: 900, bom: { pcb_8sw: 1, sw_spst: 8, usb_b: 1, cx_cor: 1, frete: 1, removida: 2 } },
      },
    },
    opts: { spare: 10 },
    inventory: { sw_spst: 5, usb_b: 2 },
    history: [
      {
        id: "lot_a",
        closedAt: "2026-05-10T10:00:00.000Z",
        status: "encerrado",
        run: {
          at: "2026-04-01T10:00:00.000Z",
          spare: 0,
          order: { m8swp: 2 },
          names: { velha: "Peça velha" },
          buys: {
            m8swp: {
              sw_spst: [{ id: "tx1", q: 16, v: 32, at: "2026-04-02T10:00:00.000Z" }],
              velha: [{ q: 1, v: 10, at: "2026-04-03T10:00:00.000Z" }],
            },
          },
        },
      },
    ],
    run: {
      at: "2026-09-01T10:00:00.000Z",
      spare: 10,
      order: { m8swp: 3, mvelho: 1 },
      bom: { mvelho: { name: "Modelo Velho" } },
      stockUsed: { m8swp: { usb_b: 1 } },
      buys: {
        // uma compra de 30 chaves dividida entre dois modelos: vira uma única compra
        m8swp: { sw_spst: [{ id: "tx2", q: 24, v: 72, at: "2026-09-02T10:00:00.000Z" }] },
        mvelho: { sw_spst: [{ id: "tx2", q: 6, v: 18, at: "2026-09-02T10:00:00.000Z" }] },
      },
    },
  };
}

describe("converterLegado", () => {
  const { registros: r, avisos } = converterLegado(backupDeExemplo(), AGORA);

  it("deduz fornecedores pelo domínio e marca importados", () => {
    expect(r.fornecedores.map((f) => f.id).sort()).toEqual(["forn_aliexpress", "forn_mercadolivre", "forn_rpcaixas"]);
    expect(r.componentes.find((c) => c.id === "sw_spst")!.origem).toBe("importado");
    expect(r.componentes.find((c) => c.id === "usb_b")!.origem).toBeUndefined();
    expect(r.componenteFornecedores.find((v) => v.componenteId === "usb_b")!.precoRef).toBe(3);
  });

  it("mapeia os modos de cobrança e separa o frete lançado como peça", () => {
    const porId = new Map(r.componentes.map((c) => [c.id, c]));
    expect(porId.get("sw_spst")!.modoCobranca).toBe("unidade");
    expect(porId.get("frete")!.modoCobranca).toBe("modelo");
    expect(porId.get("frete")!.categoria).toBe("Custo (legado)");
    expect(porId.get("frete")!.controlaEstoque).toBe(false);
    expect(porId.get("sw_spst")!.controlaEstoque).toBe(true);
    expect(porId.get("env")!.modoCobranca).toBe("lote");
  });

  it("cria produto com composição v1, ignorando peças que não existem", () => {
    const p = r.produtos.find((x) => x.id === "m8swp")!;
    expect(p.imagem).toBe(IMAGEM_8SW);
    expect(p.precoVenda).toBe(900);
    expect(p.composicaoAtualId).toBe("comp_m8swp_v1");
    const itens = r.composicaoItens.filter((i) => i.composicaoId === "comp_m8swp_v1");
    expect(itens).toHaveLength(5);
    expect(itens.find((i) => i.componenteId === "sw_spst")!.quantidade).toBe(8);
  });

  it("cria lotes do histórico e do lote em andamento, em ordem", () => {
    expect(r.lotes.map((l) => [l.codigo, l.status])).toEqual([
      ["L-001", "concluido"],
      ["L-002", "comprando"],
    ]);
    expect(r.lotes[0].concluidoEm).toBe("2026-05-10T10:00:00.000Z");
    expect(r.loteItens.find((i) => i.loteId === "lote_ativo_legado" && i.produtoId === "m8swp")!.qtdPlanejada).toBe(3);
  });

  it("cria produto inativo para modelo que só existe no histórico", () => {
    const velho = r.produtos.find((p) => p.id === "mvelho")!;
    expect(velho.nome).toBe("Modelo Velho");
    expect(velho.ativo).toBe(false);
  });

  it("agrupa a compra dividida entre modelos numa só", () => {
    const doLoteAtivo = r.compras.filter((c) => c.loteId === "lote_ativo_legado");
    expect(doLoteAtivo).toHaveLength(1);
    const item = r.compraItens.find((i) => i.compraId === doLoteAtivo[0].id)!;
    expect(item).toMatchObject({ componenteId: "sw_spst", quantidade: 30, valorTotal: 90 });
    expect(doLoteAtivo[0]).toMatchObject({ legado: true, fornecedorId: "forn_aliexpress", compradoEm: "nao_informado" });
  });

  it("cria componente inativo para peça que só aparece no histórico", () => {
    const velha = r.componentes.find((c) => c.id === "velha")!;
    expect(velha.nome).toBe("Peça velha");
    expect(velha.ativo).toBe(false);
  });

  it("saldo inicial = inventário + comprado/separado para o lote em andamento, ao custo médio das compras", () => {
    const saldos = calcularSaldos(r.movimentos);
    // chaves: 5 no inventário + 30 compradas para o lote ativo; custo médio de (32 + 90) / (16 + 30)
    expect(saldos.get("sw_spst")!.quantidade).toBe(35);
    expect(saldos.get("sw_spst")!.custoMedio).toBeCloseTo(122 / 46);
    // USB: 2 no inventário + 1 separada para o lote; sem compras, usa o preço de referência
    expect(saldos.get("usb_b")!.quantidade).toBe(3);
    expect(saldos.get("usb_b")!.custoMedio).toBe(3);
    expect(r.movimentos.every((m) => m.tipo === "saldo_inicial" && m.data === AGORA)).toBe(true);
  });

  it("guarda a margem padrão e gera avisos", () => {
    expect(r.config).toEqual([{ chave: "margemPadrao", valor: 10 }]);
    expect(avisos.some((a) => a.includes("frete/imposto"))).toBe(true);
    expect(avisos.some((a) => a.includes("origem fiscal"))).toBe(true);
  });

  it("é determinístico: reimportar gera os mesmos IDs", () => {
    const outra = converterLegado(backupDeExemplo(), AGORA).registros;
    expect(outra.compras.map((c) => c.id)).toEqual(r.compras.map((c) => c.id));
    expect(outra.movimentos.map((m) => m.id)).toEqual(r.movimentos.map((m) => m.id));
  });
});

describe("leitura", () => {
  it("reconhece o formato do backup antigo", () => {
    expect(ehBackupLegado(backupDeExemplo())).toBe(true);
    expect(ehBackupLegado({ app: "bffx-erp" })).toBe(false);
  });

  it("lê as chaves bfmidi.* do localStorage", () => {
    const b = backupDeExemplo();
    const dados: Record<string, string> = {
      "bfmidi.db.v5": JSON.stringify(b.db),
      "bfmidi.inventory.v1": JSON.stringify(b.inventory),
      "bfmidi.history.v1": JSON.stringify(b.history),
    };
    const storage = { getItem: (k: string) => dados[k] ?? null } as Storage;
    const lido = lerLegadoDoNavegador(storage)!;
    expect(lido.inventory).toEqual(b.inventory);
    expect(lido.run).toBeNull();
    expect(lerLegadoDoNavegador({ getItem: () => null } as unknown as Storage)).toBeNull();
  });
});
