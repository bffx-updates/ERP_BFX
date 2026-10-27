// Regras das compras: quanto cada peça custou de verdade e o que entra no estoque.
import type { Compra, CompraItem, Componente, ID, Movimento, StatusCompra } from "./tipos";

export const STATUS_EM_ABERTO: StatusCompra[] = ["pedido", "em_transito", "recebida_parcial"];
export const STATUS_COM_ENTRADA: StatusCompra[] = ["recebida", "recebida_parcial"];

export function adicionaisDaCompra(c: Pick<Compra, "frete" | "impostos" | "outrasDespesas">): number {
  return (Number(c.frete) || 0) + (Number(c.impostos) || 0) + (Number(c.outrasDespesas) || 0);
}

export function produtosDaCompra(itens: Pick<CompraItem, "valorTotal">[]): number {
  return itens.reduce((a, i) => a + (Number(i.valorTotal) || 0), 0);
}

export function totalDaCompra(c: Pick<Compra, "frete" | "impostos" | "outrasDespesas">, itens: Pick<CompraItem, "valorTotal">[]): number {
  return produtosDaCompra(itens) + adicionaisDaCompra(c);
}

export interface CustoDeEntrada {
  rateio: number; // parte do frete, impostos e outras despesas
  custoTotal: number; // valor do item + rateio
  custoUnitario: number;
}

// Frete, impostos e outras despesas entram no custo das peças (custo de aquisição),
// divididos na proporção do valor de cada item. Sem valores, divide pela quantidade.
export function custosDeEntrada(
  compra: Pick<Compra, "frete" | "impostos" | "outrasDespesas">,
  itens: Pick<CompraItem, "id" | "quantidade" | "valorTotal">[],
): Map<ID, CustoDeEntrada> {
  const adicionais = adicionaisDaCompra(compra);
  const somaValor = produtosDaCompra(itens);
  const somaQtd = itens.reduce((a, i) => a + Math.max(0, Number(i.quantidade) || 0), 0);
  const r = new Map<ID, CustoDeEntrada>();
  for (const i of itens) {
    const qtd = Number(i.quantidade) || 0;
    const valor = Number(i.valorTotal) || 0;
    const peso = somaValor > 0 ? valor / somaValor : somaQtd > 0 ? Math.max(0, qtd) / somaQtd : 0;
    const rateio = adicionais * peso;
    const custoTotal = valor + rateio;
    r.set(i.id, { rateio, custoTotal, custoUnitario: qtd > 0 ? custoTotal / qtd : 0 });
  }
  return r;
}

// Quanto de cada item já entrou no estoque.
export function quantidadeRecebida(compra: Pick<Compra, "status">, item: Pick<CompraItem, "quantidade" | "qtdRecebida">): number {
  if (compra.status === "recebida") return Number(item.quantidade) || 0;
  if (compra.status === "recebida_parcial") return Math.min(Number(item.qtdRecebida) || 0, Number(item.quantidade) || 0);
  return 0;
}

// Quanto ainda falta chegar (para o planejamento de lotes).
export function quantidadeAReceber(compra: Pick<Compra, "status">, item: Pick<CompraItem, "quantidade" | "qtdRecebida">): number {
  if (!STATUS_EM_ABERTO.includes(compra.status)) return 0;
  return Math.max(0, (Number(item.quantidade) || 0) - quantidadeRecebida(compra, item));
}

export const idMovimentoDaCompra = (itemId: ID) => `mov_cp_${itemId}`;

// Entradas no estoque geradas pela compra. Compras do app antigo não geram movimento:
// o estoque delas já está no saldo inicial importado.
export function movimentosDaCompra(compra: Compra, itens: CompraItem[], componentes: Map<ID, Componente>): Movimento[] {
  if (compra.legado || !STATUS_COM_ENTRADA.includes(compra.status)) return [];
  const custos = custosDeEntrada(compra, itens);
  const doc = compra.numeroNF ? `NF ${compra.numeroNF}` : undefined;
  const movimentos: Movimento[] = [];
  for (const item of itens) {
    const componente = componentes.get(item.componenteId);
    if (!componente || !componente.controlaEstoque) continue;
    const recebida = quantidadeRecebida(compra, item);
    if (!(recebida > 0)) continue;
    movimentos.push({
      id: idMovimentoDaCompra(item.id),
      data: compra.recebidaEm || compra.data,
      componenteId: item.componenteId,
      tipo: "entrada_compra",
      quantidade: recebida,
      custoUnitario: custos.get(item.id)?.custoUnitario ?? 0,
      refTipo: "compra",
      refId: compra.id,
      obs: doc,
    });
  }
  return movimentos;
}

// Valor dos itens que não vão para o estoque (ex.: frete lançado como peça):
// é custo direto do lote a que a compra pertence.
export function custoDiretoDaCompra(compra: Compra, itens: CompraItem[], componentes: Map<ID, Componente>): number {
  if (!STATUS_COM_ENTRADA.includes(compra.status)) return 0; // só o que já chegou
  const custos = custosDeEntrada(compra, itens);
  return itens
    .filter((i) => componentes.get(i.componenteId)?.controlaEstoque === false)
    .reduce((a, i) => a + (custos.get(i.id)?.custoTotal ?? 0), 0);
}
