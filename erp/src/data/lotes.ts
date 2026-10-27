// Regras dos lotes: o que precisa comprar, o que a produção consome e quanto o pedal custou.
import type { Apontamento, Componente, ComposicaoItem, CustoFabricacao, ID, Lote, LoteItem, Movimento, Produto } from "./tipos";

// A composição que vale para um item do lote: a que o lote guardou ou, se não guardou, a atual do produto.
export function composicaoDoItem(item: Pick<LoteItem, "composicaoId" | "produtoId">, produtos: Map<ID, Produto>): ID | undefined {
  return item.composicaoId ?? produtos.get(item.produtoId)?.composicaoAtualId;
}

export interface NecessidadePeca {
  componente: Componente;
  necessario: number; // sem sobra
  comSobra: number;
  consumido: number; // já baixado por apontamentos deste lote
  emEstoque: number;
  aReceber: number; // pedidos deste lote que ainda não chegaram
  aComprar: number;
}

export interface EntradaNecessidades {
  lote: Pick<Lote, "margemSobra">;
  itens: Pick<LoteItem, "produtoId" | "composicaoId" | "qtdPlanejada">[];
  produtos: Map<ID, Produto>;
  composicaoItens: ComposicaoItem[];
  componentes: Map<ID, Componente>;
  saldos: Map<ID, number>;
  aReceber: Map<ID, number>;
  consumido: Map<ID, number>;
}

// Peças por unidade: quantidade × pedais, mais a margem de sobra (arredondado para cima).
// Peças fixas por modelo: uma vez por modelo no lote. Fixas por lote: uma vez no lote todo.
export function necessidadesDoLote(e: EntradaNecessidades): NecessidadePeca[] {
  const porUnidade = new Map<ID, number>();
  const fixo = new Map<ID, number>();
  const porLote = new Map<ID, number>();
  for (const item of e.itens) {
    const qtd = Number(item.qtdPlanejada) || 0;
    if (qtd <= 0) continue;
    const composicaoId = composicaoDoItem(item, e.produtos);
    for (const ci of e.composicaoItens.filter((c) => c.composicaoId === composicaoId)) {
      const comp = e.componentes.get(ci.componenteId);
      if (!comp || !comp.controlaEstoque) continue;
      if (comp.modoCobranca === "unidade") porUnidade.set(comp.id, (porUnidade.get(comp.id) ?? 0) + ci.quantidade * qtd);
      else if (comp.modoCobranca === "modelo") fixo.set(comp.id, (fixo.get(comp.id) ?? 0) + ci.quantidade);
      else porLote.set(comp.id, Math.max(porLote.get(comp.id) ?? 0, ci.quantidade));
    }
  }
  const ids = new Set([...porUnidade.keys(), ...fixo.keys(), ...porLote.keys()]);
  const margem = Math.max(0, Number(e.lote.margemSobra) || 0) / 100;
  const linhas: NecessidadePeca[] = [];
  for (const id of ids) {
    const componente = e.componentes.get(id)!;
    const unidade = porUnidade.get(id) ?? 0;
    const fixos = (fixo.get(id) ?? 0) + (porLote.get(id) ?? 0);
    const necessario = unidade + fixos;
    const comSobra = Math.ceil(unidade * (1 + margem) - 1e-9) + fixos;
    const consumido = e.consumido.get(id) ?? 0;
    const emEstoque = Math.max(0, e.saldos.get(id) ?? 0);
    const aReceber = e.aReceber.get(id) ?? 0;
    const falta = comSobra - consumido - emEstoque - aReceber;
    linhas.push({ componente, necessario, comSobra, consumido, emEstoque, aReceber, aComprar: Math.max(0, Math.ceil(falta - 1e-9)) });
  }
  return linhas.sort(
    (a, b) => a.componente.categoria.localeCompare(b.componente.categoria, "pt-BR") || a.componente.nome.localeCompare(b.componente.nome, "pt-BR"),
  );
}

export const idMovimentoDeConsumo = (apontamentoId: ID, componenteId: ID) => `mov_ap_${apontamentoId}_${componenteId}`;

export interface EntradaConsumo {
  lote: Pick<Lote, "id" | "codigo">;
  apontamentos: Apontamento[];
  itens: Pick<LoteItem, "produtoId" | "composicaoId">[];
  produtos: Map<ID, Produto>;
  composicaoItens: ComposicaoItem[];
  componentes: Map<ID, Componente>;
}

// Baixas de estoque de todos os apontamentos de um lote. Peças por unidade saem a cada
// pedal montado (bom ou refugado); peças fixas saem no primeiro apontamento do modelo/lote.
export function movimentosDeConsumo(e: EntradaConsumo): Movimento[] {
  const ordenados = [...e.apontamentos].sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
  const modelosVistos = new Set<ID>();
  const fixosDoLote = new Set<ID>();
  const movimentos: Movimento[] = [];
  for (const ap of ordenados) {
    const montados = (Number(ap.qtdBoa) || 0) + (Number(ap.qtdRefugo) || 0);
    const item = e.itens.find((i) => i.produtoId === ap.produtoId) ?? { produtoId: ap.produtoId };
    const composicaoId = composicaoDoItem(item, e.produtos);
    const primeiroDoModelo = !modelosVistos.has(ap.produtoId);
    modelosVistos.add(ap.produtoId);
    const consumo = new Map<ID, number>();
    for (const ci of e.composicaoItens.filter((c) => c.composicaoId === composicaoId)) {
      const comp = e.componentes.get(ci.componenteId);
      if (!comp || !comp.controlaEstoque) continue;
      let q = 0;
      if (comp.modoCobranca === "unidade") q = ci.quantidade * montados;
      else if (comp.modoCobranca === "modelo") q = primeiroDoModelo && montados > 0 ? ci.quantidade : 0;
      else if (montados > 0 && !fixosDoLote.has(comp.id)) {
        q = ci.quantidade;
        fixosDoLote.add(comp.id);
      }
      if (q > 0) consumo.set(comp.id, (consumo.get(comp.id) ?? 0) + q);
    }
    const produto = e.produtos.get(ap.produtoId)?.nome ?? "pedal";
    for (const [componenteId, q] of consumo) {
      movimentos.push({
        id: idMovimentoDeConsumo(ap.id, componenteId),
        data: ap.data,
        componenteId,
        tipo: "consumo_producao",
        quantidade: -q,
        refTipo: "apontamento",
        refId: ap.id,
        obs: `Lote ${e.lote.codigo} · ${montados}× ${produto}`,
      });
    }
  }
  return movimentos;
}

export interface CustoReal {
  materiais: number; // peças baixadas do estoque, pelo custo médio da hora da baixa
  diretos: number; // compras do lote que não passam pelo estoque (frete lançado como peça etc.)
  maoDeObra: number;
  outros: number;
  total: number;
  pedaisBons: number;
  refugo: number;
  horas: number;
  porPedal: number | null;
}

export function custoRealDoLote(e: {
  materiais: number;
  diretos: number;
  custos: Pick<CustoFabricacao, "tipo" | "valor" | "horas">[];
  apontamentos: Pick<Apontamento, "qtdBoa" | "qtdRefugo" | "horas">[];
}): CustoReal {
  const maoDeObra = e.custos.filter((c) => c.tipo === "mao_de_obra").reduce((a, c) => a + (Number(c.valor) || 0), 0);
  const outros = e.custos.filter((c) => c.tipo !== "mao_de_obra").reduce((a, c) => a + (Number(c.valor) || 0), 0);
  const pedaisBons = e.apontamentos.reduce((a, x) => a + (Number(x.qtdBoa) || 0), 0);
  const refugo = e.apontamentos.reduce((a, x) => a + (Number(x.qtdRefugo) || 0), 0);
  const horas = e.apontamentos.reduce((a, x) => a + (Number(x.horas) || 0), 0);
  const total = e.materiais + e.diretos + maoDeObra + outros;
  return { materiais: e.materiais, diretos: e.diretos, maoDeObra, outros, total, pedaisBons, refugo, horas, porPedal: pedaisBons > 0 ? total / pedaisBons : null };
}

// Próximo código livre no formato L-001.
export function proximoCodigoDeLote(codigos: string[]): string {
  const maior = codigos.reduce((m, c) => {
    const n = Number(/^L-(\d+)$/i.exec(c.trim())?.[1]);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `L-${String(maior + 1).padStart(3, "0")}`;
}
