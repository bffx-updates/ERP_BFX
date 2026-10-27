import type { ID, ModoCobranca, Movimento } from "./tipos";

export interface Saldo {
  quantidade: number;
  custoMedio: number;
  valor: number;
}

// Ordem do livro: por data; na mesma data, entradas antes das saídas (a peça que chega no dia
// pode ser usada no mesmo dia); empate final pelo id, para o resultado não variar.
export function ordemCronologica(a: Movimento, b: Movimento): number {
  return a.data.localeCompare(b.data) || Number(b.quantidade > 0) - Number(a.quantidade > 0) || a.id.localeCompare(b.id);
}

// Custo médio ponderado móvel: cada entrada com custo recalcula a média;
// saídas baixam a quantidade pelo custo médio vigente, sem alterar a média.
export function calcularSaldos(movimentos: Movimento[]): Map<ID, Saldo> {
  const ordenados = [...movimentos].sort(ordemCronologica);
  const saldos = new Map<ID, Saldo>();

  for (const m of ordenados) {
    const s = saldos.get(m.componenteId) ?? { quantidade: 0, custoMedio: 0, valor: 0 };
    if (m.quantidade > 0) {
      const custo = m.custoUnitario ?? s.custoMedio;
      const base = Math.max(0, s.quantidade);
      const novaQtd = base + m.quantidade;
      s.custoMedio = novaQtd > 0 ? (base * s.custoMedio + m.quantidade * custo) / novaQtd : 0;
      s.quantidade = s.quantidade + m.quantidade;
    } else {
      s.quantidade = s.quantidade + m.quantidade;
    }
    s.valor = Math.max(0, s.quantidade) * s.custoMedio;
    saldos.set(m.componenteId, s);
  }
  return saldos;
}

// Uma linha da ficha de estoque (kardex): o movimento com o custo que ele efetivamente usou
// e o saldo do componente logo depois dele.
export interface LinhaLivro {
  movimento: Movimento;
  custoUnitario: number; // entrada: custo informado (ou médio, se não informado); saída: custo médio vigente
  valor: number; // quantidade × custo unitário (negativo nas saídas)
  saldoQuantidade: number;
  custoMedio: number;
  saldoValor: number;
}

// Mesmo cálculo de calcularSaldos, guardando cada passo. Ordem cronológica.
export function livroDeEstoque(movimentos: Movimento[]): LinhaLivro[] {
  const ordenados = [...movimentos].sort(ordemCronologica);
  const saldos = new Map<ID, Saldo>();
  const linhas: LinhaLivro[] = [];
  for (const m of ordenados) {
    const s = saldos.get(m.componenteId) ?? { quantidade: 0, custoMedio: 0, valor: 0 };
    let custo: number;
    if (m.quantidade > 0) {
      custo = m.custoUnitario ?? s.custoMedio;
      const base = Math.max(0, s.quantidade);
      const novaQtd = base + m.quantidade;
      s.custoMedio = novaQtd > 0 ? (base * s.custoMedio + m.quantidade * custo) / novaQtd : 0;
    } else {
      custo = s.custoMedio;
    }
    s.quantidade += m.quantidade;
    s.valor = Math.max(0, s.quantidade) * s.custoMedio;
    saldos.set(m.componenteId, s);
    linhas.push({
      movimento: m,
      custoUnitario: custo,
      valor: m.quantidade * custo,
      saldoQuantidade: s.quantidade,
      custoMedio: s.custoMedio,
      saldoValor: s.valor,
    });
  }
  return linhas;
}

// Saldos considerando só os movimentos até uma data (ISO, inclusive).
export function saldosAte(movimentos: Movimento[], ateIso: string): Map<ID, Saldo> {
  return calcularSaldos(movimentos.filter((m) => m.data <= ateIso));
}

// O saldo trazido do app antigo representa peças que já existiam antes, mesmo que tenha
// sido importado depois. Na contagem da transição ele conta como se estivesse na data dela.
export const importadoDepois = (m: Movimento, ateIso: string) => m.refTipo === "importacao" && m.data > ateIso;

export function saldosParaContagem(movimentos: Movimento[], ateIso: string, transicao: boolean): Map<ID, Saldo> {
  return calcularSaldos(movimentos.filter((m) => m.data <= ateIso || (transicao && importadoDepois(m, ateIso))));
}

export interface ItemMontagem {
  nome: string;
  quantidade: number; // por pedal (unidade) ou por lote (modelo/lote)
  modo: ModoCobranca;
  saldo: number;
}

export interface CapacidadeMontagem {
  unidades: number | null; // null = composição sem peças de estoque
  limitantes: ItemMontagem[];
}

// Quantos pedais dá para montar só com o estoque. Peças por unidade limitam pela divisão;
// peças fixas por modelo/lote só precisam existir na quantidade da composição.
export function capacidadeDeMontagem(itens: ItemMontagem[]): CapacidadeMontagem {
  let unidades = Infinity;
  let limitantes: ItemMontagem[] = [];
  for (const item of itens) {
    if (!(item.quantidade > 0)) continue;
    const saldo = Math.max(0, item.saldo);
    const possivel =
      item.modo === "unidade" ? Math.floor(saldo / item.quantidade + 1e-9) : saldo >= item.quantidade ? Infinity : 0;
    if (possivel < unidades) {
      unidades = possivel;
      limitantes = [item];
    } else if (possivel === unidades && possivel !== Infinity) {
      limitantes.push(item);
    }
  }
  return unidades === Infinity ? { unidades: null, limitantes: [] } : { unidades, limitantes };
}

export type SituacaoEstoque = "zerado" | "baixo" | "ok";

export function situacao(quantidade: number, minimo: number): SituacaoEstoque {
  if (quantidade <= 0) return "zerado";
  if (quantidade <= Math.max(minimo, 0)) return "baixo";
  return "ok";
}
