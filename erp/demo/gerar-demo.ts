// Monta os dados de demonstração usando as próprias regras do ERP (compras, recebimento,
// produção, custos), para tudo ficar coerente: estoque, custo médio e relatórios.
// Tudo aqui é fictício: CNPJs, notas e fornecedores marcados com "(exemplo)".
// Uso: npm run demo:dados   →   demo/backup-demonstracao.json
import "fake-indexeddb/auto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { apagarTudo, gerarSnapshot } from "../src/backup/snapshot";
import {
  anexarArquivo,
  aplicarContagem,
  gerarPedidos,
  lancarMovimento,
  mudarStatusDoLote,
  salvarApontamento,
  salvarCompra,
  salvarComponente,
  salvarCustoFabricacao,
  salvarFornecedor,
  salvarLote,
  salvarProduto,
  type LinhaPedido,
} from "../src/data/acoes";
import { quantidadeAReceber } from "../src/data/compras";
import { db, salvarConfig } from "../src/data/db";
import { calcularSaldos } from "../src/data/estoque";
import { diaParaIso } from "../src/data/formato";
import { necessidadesDoLote } from "../src/data/lotes";
import type { ComposicaoItem, Empresa, TipoDocumento } from "../src/data/tipos";

const arquivo = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const dia = diaParaIso;

// ---------- Documentos fictícios com dígitos verificadores válidos ----------

function dvCnpj(base: string): number {
  const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const r = [...base].reduce((a, c, i) => a + Number(c) * pesos[i], 0) % 11;
  return r < 2 ? 0 : 11 - r;
}
function cnpj(base12: string): string {
  const d1 = dvCnpj(base12);
  return base12 + d1 + dvCnpj(base12 + d1);
}
function chaveNFe(cnpjEmitente: string, aamm: string, numero: number, serie = 1): string {
  const base = `41${aamm}${cnpjEmitente}55${String(serie).padStart(3, "0")}${String(numero).padStart(9, "0")}1${String((numero * 7919) % 1e8).padStart(8, "0")}`;
  let peso = 2;
  let soma = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return base + (r < 2 ? 0 : 11 - r);
}

const CNPJ_METALURGICA = cnpj("483920170001");
const CNPJ_PLACAS = cnpj("275118440001");
const CNPJ_ELETRONICA = cnpj("609731250001");
const CNPJ_RPCAIXAS_EXEMPLO = cnpj("531604880001");

// ---------- Cadastros ----------

async function cadastros() {
  const empresa: Empresa = {
    nome: "BFX Technologies",
    razaoSocial: "BFX TECHNOLOGIES LTDA (DEMONSTRAÇÃO)",
    cnpj: "12.345.678/0001-95",
    regime: "me_simples",
    dataTransicao: "2026-07-01",
    contador: "Escritório de contabilidade (exemplo)",
  };
  await salvarConfig("empresa", empresa);
  await salvarConfig("producao", { valorHora: 45, margemPadrao: 10 });

  const f = {
    ali: await salvarFornecedor({ nome: "AliExpress", tipo: "importacao", pais: "China", site: "https://pt.aliexpress.com", prazoDias: 25, ativo: true }),
    ml: await salvarFornecedor({ nome: "Mercado Livre", tipo: "nacional", pais: "Brasil", site: "https://www.mercadolivre.com.br", prazoDias: 4, ativo: true }),
    rp: await salvarFornecedor({ nome: "Caixas e Embalagens (exemplo)", tipo: "nacional", documento: CNPJ_RPCAIXAS_EXEMPLO, pais: "Brasil", prazoDias: 6, ativo: true }),
    metal: await salvarFornecedor({ nome: "Metalúrgica Andrade (exemplo)", tipo: "nacional", documento: CNPJ_METALURGICA, pais: "Brasil", contato: "Roberto (vendas)", prazoDias: 10, obs: "Caixas de alumínio usinadas e anodizadas.", ativo: true }),
    placas: await salvarFornecedor({ nome: "Placas Sul (exemplo)", tipo: "nacional", documento: CNPJ_PLACAS, pais: "Brasil", prazoDias: 8, obs: "Fabricação das PCBs.", ativo: true }),
    eletro: await salvarFornecedor({ nome: "Eletrônica Centro (exemplo)", tipo: "nacional", documento: CNPJ_ELETRONICA, pais: "Brasil", prazoDias: 3, ativo: true }),
  };

  type Peca = [nome: string, categoria: string, variante: string | undefined, ncm: string | undefined, origem: "nacional" | "importado", minimo: number, preco: number, fornecedor: string];
  const pecas: Record<string, Peca> = {
    pcb8: ["PCB 8SW+", "Placa", "4 camadas, acabamento ENIG", "85340000", "nacional", 2, 46.5, f.placas],
    pcbN: ["PCB NANO+", "Placa", "4 camadas, acabamento ENIG", "85340000", "nacional", 2, 31.8, f.placas],
    sw: ["Chave SPST", "Eletromecânica", "Footswitch momentâneo", "85365090", "importado", 30, 4.6, f.ali],
    nylon: ["Nylon Rig", "Eletromecânica", "M12x20x1 White", "39269090", "importado", 30, 0.92, f.ali],
    display: ["Display", "Interface", "ST7796S LCD 480x320", undefined, "importado", 2, 74.9, f.ali],
    esp: ["ESP32-S3 N16R8", "Microcontroladores", "ESP32-S3-WROOM-1-N16R8", undefined, "importado", 2, 38.4, f.ali],
    zero: ["ESP32-S3 ZERO (host)", "Microcontroladores", "ESP32-S3-zero", undefined, "importado", 2, 27.9, f.ali],
    usb: ["Conector USB-B", "Conectores", "90 graus, solda em placa", "85366990", "nacional", 4, 2.4, f.eletro],
    din: ["Conector DIN5", "Conectores", "DIN 5 pinos DS-5-01 MIDI", "85366990", "importado", 4, 5.9, f.ali],
    dc: ["Conector DC", "Conectores", "DC-005 2,1 mm", "85366990", "importado", 4, 1.15, f.ali],
    fonte: ["Fonte DC 5V", "Alimentação", "Conversor DC-DC buck 5V 3A", "85044090", "importado", 3, 8.7, f.ali],
    cx8: ["Caixa Metal 8SW+", "Gabinete", "Alumínio anodizado preto", "76169900", "nacional", 2, 118, f.metal],
    cxN: ["Caixa Metal NANO+", "Gabinete", "Alumínio anodizado preto", "76169900", "nacional", 2, 84, f.metal],
    cor8: ["Caixa Correio 8SW+", "Embalagem", "Papelão branco 25 x 17 x 7", "48191000", "nacional", 4, 3.6, f.rp],
    corN: ["Caixa Correio NANO+", "Embalagem", "Papelão branco 19 x 12 x 7", "48191000", "nacional", 4, 3.1, f.rp],
    env: ["Envelope Correio", "Embalagem", "Bolha, cinza, 26 x 36", "39232190", "nacional", 10, 1.6, f.ml],
  };
  const c: Record<string, string> = {};
  for (const [chave, [nome, categoria, variante, ncm, origem, estoqueMinimo, custoReferencia, fornecedorId]] of Object.entries(pecas)) {
    c[chave] = await salvarComponente(
      { nome, categoria, variante, ncm, origem, unidade: "un", estoqueMinimo, custoReferencia, modoCobranca: "unidade", controlaEstoque: true, ativo: true, sku: chave.toUpperCase() },
      [{ fornecedorId, precoRef: custoReferencia, preferido: true }],
    );
  }

  const foto = (nome: string) => `data:image/png;base64,${readFileSync(arquivo(`../src/assets/produtos/${nome}`)).toString("base64")}`;
  const p8 = await salvarProduto(
    { nome: "BFMiDi 8SW+", sku: "BFM-8SW", imagem: foto("8sw.png"), precoVenda: 1490, tipo: "fabricacao", cfop: "5101", origemFiscal: "5", ativo: true },
    [["pcb8", 1], ["sw", 8], ["nylon", 8], ["fonte", 1], ["display", 1], ["usb", 1], ["din", 1], ["dc", 1], ["esp", 1], ["zero", 1], ["cx8", 1], ["cor8", 1], ["env", 1]].map(([k, q]) => ({ componenteId: c[k as string], quantidade: q as number })),
    "Primeira versão",
  );
  const pN = await salvarProduto(
    { nome: "BFMiDi NANO+", sku: "BFM-NANO", imagem: foto("nano.png"), precoVenda: 990, tipo: "fabricacao", cfop: "5101", origemFiscal: "5", ativo: true },
    [["pcbN", 1], ["sw", 6], ["nylon", 6], ["fonte", 1], ["display", 1], ["usb", 1], ["dc", 1], ["esp", 1], ["zero", 1], ["cxN", 1], ["corN", 1], ["env", 1]].map(([k, q]) => ({ componenteId: c[k as string], quantidade: q as number })),
    "Primeira versão",
  );
  return { f, c, p8: p8.id, pN: pN.id };
}

// ---------- Lotes: pedidos pelo planejamento, como na tela ----------

async function pedidosDoLote(loteId: string, quando: string) {
  const [lote, itens, produtos, componentes, composicaoItens, movimentos, vinculos] = await Promise.all([
    db.lotes.get(loteId),
    db.loteItens.where("loteId").equals(loteId).toArray(),
    db.produtos.toArray(),
    db.componentes.toArray(),
    db.composicaoItens.toArray(),
    db.movimentos.toArray(),
    db.componenteFornecedores.toArray(),
  ]);
  const saldos = new Map([...calcularSaldos(movimentos)].map(([k, s]) => [k, s.quantidade]));
  const necessidades = necessidadesDoLote({
    lote: lote!,
    itens,
    produtos: new Map(produtos.map((p) => [p.id, p])),
    composicaoItens: composicaoItens as ComposicaoItem[],
    componentes: new Map(componentes.map((x) => [x.id, x])),
    saldos,
    aReceber: new Map(),
    consumido: new Map(),
  });
  const linhas: LinhaPedido[] = necessidades
    .filter((n) => n.aComprar > 0)
    .map((n) => {
      const v = vinculos.find((x) => x.componenteId === n.componente.id);
      return { componenteId: n.componente.id, quantidade: n.aComprar, fornecedorId: v?.fornecedorId, precoUnitario: v?.precoRef ?? 0 };
    });
  return gerarPedidos(loteId, linhas, quando);
}

interface Recebimento {
  documento: TipoDocumento;
  numero?: string;
  cnpj?: string; // para montar a chave da NF-e
  frete?: number;
  impostosPct?: number;
  outras?: number;
  reajuste?: number; // preço real ÷ preço de referência
  recebidaEm: string;
  compraEm?: string;
  parcial?: number; // fração que já chegou (recebimento parcial)
  obs?: string;
}

async function receberPedidos(loteId: string, porFornecedor: Record<string, Recebimento | "em_transito">) {
  const compras = await db.compras.where("loteId").equals(loteId).toArray();
  for (const compra of compras) {
    const r = porFornecedor[compra.fornecedorId ?? ""];
    if (!r) continue;
    const itens = await db.compraItens.where("compraId").equals(compra.id).toArray();
    if (r === "em_transito") {
      await salvarCompra({ ...compra, status: "em_transito", documentoTipo: "importacao", obs: "Pedido AliExpress, rastreio enviado pelo vendedor." }, itens);
      continue;
    }
    const novosItens = itens.map((i) => ({
      ...i,
      valorTotal: Math.round(i.valorTotal * (r.reajuste ?? 1) * 100) / 100,
      qtdRecebida: r.parcial ? Math.ceil(i.quantidade * r.parcial) : i.quantidade,
    }));
    const produtos = novosItens.reduce((a, i) => a + i.valorTotal, 0);
    const aamm = r.recebidaEm.slice(2, 4) + r.recebidaEm.slice(5, 7);
    await salvarCompra(
      {
        ...compra,
        data: r.compraEm ? dia(r.compraEm) : r.documento === "nfe" ? dia(diasAntes(r.recebidaEm, 2)) : compra.data,
        status: r.parcial ? "recebida_parcial" : "recebida",
        recebidaEm: dia(r.recebidaEm),
        documentoTipo: r.documento,
        numeroNF: r.numero,
        serieNF: r.documento === "nfe" ? "1" : undefined,
        chaveNFe: r.documento === "nfe" && r.cnpj && r.numero ? chaveNFe(r.cnpj, aamm, Number(r.numero)) : undefined,
        frete: r.frete ?? 0,
        impostos: Math.round(produtos * (r.impostosPct ?? 0) * 100) / 100,
        outrasDespesas: r.outras ?? 0,
        obs: r.obs,
      },
      novosItens,
    );
  }
}

function diasAntes(diaTexto: string, n: number): string {
  const [a, m, d] = diaTexto.split("-").map(Number);
  const x = new Date(a, m - 1, d - n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

async function concluir(loteId: string, quando: string) {
  await mudarStatusDoLote(loteId, "concluido");
  await db.lotes.update(loteId, { concluidoEm: dia(quando) });
}

async function semNegativos(momento: string) {
  const saldos = calcularSaldos(await db.movimentos.toArray());
  const negativos = [...saldos].filter(([, s]) => s.quantidade < 0);
  expect(negativos, `estoque negativo depois de ${momento}`).toEqual([]);
}

it("gera os dados de demonstração", async () => {
  await apagarTudo();
  const { f, c, p8, pN } = await cadastros();

  // Contagem da transição MEI → ME em 01/07: vira o saldo inicial oficial.
  await aplicarContagem(
    "2026-07-01",
    Object.entries({ sw: 40, nylon: 60, usb: 12, din: 6, dc: 12, fonte: 4, env: 24, cor8: 8, corN: 6, zero: 3, pcbN: 1, display: 2, esp: 2 }).map(([k, contado]) => ({ componenteId: c[k], contado })),
    true,
  );

  // ----- Lote L-001 (julho) -----
  const l1 = await salvarLote({ codigo: "L-001", nome: "4× BFMiDi 8SW+, 2× BFMiDi NANO+", status: "planejado", margemSobra: 10, criadoEm: dia("2026-07-03") }, [
    { produtoId: p8, qtdPlanejada: 4 },
    { produtoId: pN, qtdPlanejada: 2 },
  ]);
  await pedidosDoLote(l1, dia("2026-07-03"));
  await receberPedidos(l1, {
    [f.ali]: { documento: "importacao", numero: "LB482913377CN", impostosPct: 0.35, reajuste: 0.97, recebidaEm: "2026-07-21", obs: "Remessa internacional com impostos pagos no Remessa Conforme." },
    [f.placas]: { documento: "nfe", numero: "1021", cnpj: CNPJ_PLACAS, frete: 25, recebidaEm: "2026-07-12" },
    [f.metal]: { documento: "nfe", numero: "4710", cnpj: CNPJ_METALURGICA, frete: 40, recebidaEm: "2026-07-14" },
    [f.rp]: { documento: "nfe", numero: "88213", cnpj: CNPJ_RPCAIXAS_EXEMPLO, frete: 18, recebidaEm: "2026-07-10" },
    [f.eletro]: { documento: "nfe", numero: "33021", cnpj: CNPJ_ELETRONICA, frete: 12, recebidaEm: "2026-07-08" },
  });
  await semNegativos("compras do L-001");
  await salvarCustoFabricacao({ loteId: l1, data: dia("2026-07-20"), tipo: "terceirizado", descricao: "Gravação a laser das caixas", valor: 120 });
  await salvarApontamento({ loteId: l1, produtoId: p8, data: dia("2026-07-22"), qtdBoa: 2, qtdRefugo: 0, horas: 5, obs: "Séries 8SW-001 a 002" }, 45);
  await salvarApontamento({ loteId: l1, produtoId: p8, data: dia("2026-07-24"), qtdBoa: 2, qtdRefugo: 0, horas: 4.5, obs: "Séries 8SW-003 a 004" }, 45);
  await salvarApontamento({ loteId: l1, produtoId: pN, data: dia("2026-07-25"), qtdBoa: 2, qtdRefugo: 0, horas: 3.5, obs: "Séries NANO-001 a 002" }, 45);
  await salvarCustoFabricacao({ loteId: l1, data: dia("2026-07-25"), tipo: "consumiveis", descricao: "Solda, fluxo e fita kapton", valor: 42.8 });
  await semNegativos("produção do L-001");
  await concluir(l1, "2026-07-28");

  // ----- Lote L-002 (setembro) -----
  const l2 = await salvarLote({ codigo: "L-002", nome: "5× BFMiDi 8SW+, 3× BFMiDi NANO+", status: "planejado", margemSobra: 10, criadoEm: dia("2026-08-28") }, [
    { produtoId: p8, qtdPlanejada: 5 },
    { produtoId: pN, qtdPlanejada: 3 },
  ]);
  await pedidosDoLote(l2, dia("2026-08-28"));
  await receberPedidos(l2, {
    [f.ali]: { documento: "importacao", numero: "LB519027645CN", impostosPct: 0.35, reajuste: 1.02, recebidaEm: "2026-09-12" },
    [f.placas]: { documento: "nfe", numero: "1088", cnpj: CNPJ_PLACAS, frete: 25, recebidaEm: "2026-09-08" },
    [f.metal]: { documento: "nfe", numero: "4802", cnpj: CNPJ_METALURGICA, frete: 40, reajuste: 1.05, recebidaEm: "2026-09-10" },
    [f.rp]: { documento: "nfe", numero: "89540", cnpj: CNPJ_RPCAIXAS_EXEMPLO, frete: 18, recebidaEm: "2026-09-04" },
    [f.eletro]: { documento: "nfe", numero: "33377", cnpj: CNPJ_ELETRONICA, frete: 12, recebidaEm: "2026-09-03" },
    [f.ml]: { documento: "sem_documento", recebidaEm: "2026-09-04", obs: "Comprado como pessoa física no app; pedir a nota ao vendedor." },
  });
  // Compra avulsa no Mercado Livre, sem lote, sem nota: aparece nas pendências do contador.
  await salvarCompra(
    { data: dia("2026-09-02"), recebidaEm: dia("2026-09-05"), status: "recebida", documentoTipo: "sem_documento", compradoEm: "cpf", frete: 0, impostos: 0, outrasDespesas: 0, moeda: "BRL", fornecedorId: f.ml, obs: "Envelopes extras; comprado na conta pessoal." },
    [{ componenteId: c.env, quantidade: 50, valorTotal: 74.5, qtdRecebida: 50 }],
  );
  await lancarMovimento({ componenteId: c.display, tipo: "devolucao", quantidade: -1, data: dia("2026-09-14"), obs: "Pixel morto; devolvido ao vendedor com reembolso." });
  await semNegativos("compras do L-002");
  await salvarApontamento({ loteId: l2, produtoId: p8, data: dia("2026-09-16"), qtdBoa: 3, qtdRefugo: 0, horas: 7, obs: "Séries 8SW-005 a 007" }, 45);
  await salvarApontamento({ loteId: l2, produtoId: p8, data: dia("2026-09-18"), qtdBoa: 2, qtdRefugo: 0, horas: 4.5, obs: "Séries 8SW-008 a 009" }, 45);
  await salvarApontamento({ loteId: l2, produtoId: pN, data: dia("2026-09-21"), qtdBoa: 3, qtdRefugo: 0, horas: 5, obs: "Séries NANO-003 a 005" }, 45);
  await lancarMovimento({ componenteId: c.sw, tipo: "perda", quantidade: -2, data: dia("2026-09-21"), obs: "Duas chaves com mau contato no teste de bancada." });
  await salvarCustoFabricacao({ loteId: l2, data: dia("2026-09-21"), tipo: "consumiveis", descricao: "Solda, fluxo e fita kapton", valor: 55.4 });
  await salvarCustoFabricacao({ loteId: l2, data: dia("2026-09-22"), tipo: "energia", descricao: "Rateio da conta de luz da bancada", valor: 38 });
  await semNegativos("produção do L-002");
  await concluir(l2, "2026-09-24");

  // Conferência do trimestre: duas diferenças pequenas viram ajustes.
  const saldos930 = calcularSaldos((await db.movimentos.toArray()).filter((m) => m.data <= dia("2026-09-30")));
  await aplicarContagem(
    "2026-09-30",
    Object.values(c).map((id) => ({ componenteId: id, contado: Math.max(0, saldos930.get(id)?.quantidade ?? 0) - (id === c.nylon ? 2 : id === c.dc ? 1 : 0) })),
    false,
  );

  // ----- Lote L-003 (outubro, em andamento) -----
  const l3 = await salvarLote({ codigo: "L-003", nome: "4× BFMiDi 8SW+, 4× BFMiDi NANO+", status: "planejado", margemSobra: 10, criadoEm: dia("2026-10-06") }, [
    { produtoId: p8, qtdPlanejada: 4 },
    { produtoId: pN, qtdPlanejada: 4 },
  ]);
  await pedidosDoLote(l3, dia("2026-10-06"));
  await receberPedidos(l3, {
    [f.ali]: { documento: "importacao", numero: "LB603318204CN", impostosPct: 0.35, parcial: 0.5, recebidaEm: "2026-10-21", obs: "Chegou o primeiro pacote; o segundo ainda está em trânsito." },
    [f.placas]: { documento: "nfe", numero: "1154", cnpj: CNPJ_PLACAS, frete: 25, recebidaEm: "2026-10-16" },
    [f.metal]: { documento: "nfe", numero: "4931", cnpj: CNPJ_METALURGICA, frete: 40, recebidaEm: "2026-10-20" },
    [f.rp]: { documento: "nfe", numero: "91002", cnpj: CNPJ_RPCAIXAS_EXEMPLO, frete: 18, recebidaEm: "2026-10-14" },
    [f.eletro]: { documento: "nfe", numero: "33810", cnpj: CNPJ_ELETRONICA, frete: 12, recebidaEm: "2026-10-13" },
  });
  // O XML de cada NF-e fica anexado à compra, como o contador gosta de receber.
  const fornecedores = new Map((await db.fornecedores.toArray()).map((x) => [x.id, x]));
  const componentes = new Map((await db.componentes.toArray()).map((x) => [x.id, x]));
  for (const compra of await db.compras.toArray()) {
    if (compra.documentoTipo !== "nfe" || !compra.chaveNFe) continue;
    const forn = fornecedores.get(compra.fornecedorId ?? "")!;
    const itens = await db.compraItens.where("compraId").equals(compra.id).toArray();
    const xml = notaXml(
      compra.chaveNFe,
      compra.numeroNF!,
      compra.data,
      forn.documento!,
      forn.nome.toUpperCase(),
      itens.map((i) => {
        const k = componentes.get(i.componenteId)!;
        return { q: i.quantidade, v: i.valorTotal, nome: `${k.nome} ${k.variante ?? ""}`.trim().toUpperCase(), ncm: k.ncm ?? "" };
      }),
      compra.frete,
    );
    await anexarArquivo("compra", compra.id, new File([xml], `NFe-${compra.numeroNF}.xml`, { type: "text/xml" }) as unknown as File);
  }
  await semNegativos("compras do L-003");
  await salvarApontamento({ loteId: l3, produtoId: p8, data: dia("2026-10-22"), qtdBoa: 2, qtdRefugo: 0, horas: 4.5, obs: "Séries 8SW-010 a 011; o resto espera a remessa da AliExpress" }, 45);
  await semNegativos("produção do L-003");

  const parciais = (await db.compras.toArray()).filter((x) => x.status === "recebida_parcial");
  expect(parciais).toHaveLength(1);
  const faltam = (await db.compraItens.where("compraId").equals(parciais[0].id).toArray()).reduce((a, i) => a + quantidadeAReceber(parciais[0], i), 0);
  expect(faltam).toBeGreaterThan(0);

  const snapshot = await gerarSnapshot();
  writeFileSync(arquivo("./backup-demonstracao.json"), JSON.stringify(snapshot));
  console.log(
    "Demonstração:",
    Object.entries(snapshot.tabelas)
      .map(([t, l]) => `${t} ${l?.length ?? 0}`)
      .join(", "),
  );
});

function notaXml(chave: string, numero: string, emissao: string, cnpjEmit: string, nome: string, itens: { q: number; v: number; nome: string; ncm: string }[], frete: number): string {
  const prod = itens.reduce((a, i) => a + i.v, 0);
  const det = itens
    .map(
      (i, k) =>
        `<det nItem="${k + 1}"><prod><cProd>${String(k + 1).padStart(3, "0")}</cProd><xProd>${i.nome}</xProd><NCM>${i.ncm}</NCM><CFOP>5101</CFOP><uCom>UN</uCom><qCom>${i.q.toFixed(4)}</qCom><vUnCom>${(i.v / i.q).toFixed(4)}</vUnCom><vProd>${i.v.toFixed(2)}</vProd></prod></det>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><cUF>41</cUF><natOp>VENDA DE PRODUCAO DO ESTABELECIMENTO</natOp><mod>55</mod><serie>1</serie><nNF>${numero}</nNF><dhEmi>${emissao}</dhEmi></ide><emit><CNPJ>${cnpjEmit}</CNPJ><xNome>${nome}</xNome></emit><dest><CNPJ>12345678000195</CNPJ><xNome>BFX TECHNOLOGIES LTDA (DEMONSTRACAO)</xNome></dest>${det}<total><ICMSTot><vProd>${prod.toFixed(2)}</vProd><vDesc>0.00</vDesc><vFrete>${frete.toFixed(2)}</vFrete><vNF>${(prod + frete).toFixed(2)}</vNF></ICMSTot></total></infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${chave}</chNFe></infProt></protNFe></nfeProc>`;
}
