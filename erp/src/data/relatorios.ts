// Cálculos que juntam várias tabelas: custo real dos lotes e os relatórios para a contabilidade.
// Funções puras sobre uma "base" com todas as tabelas, para poderem ser testadas sem banco.
import { custoDiretoDaCompra, custosDeEntrada, produtosDaCompra, adicionaisDaCompra, STATUS_COM_ENTRADA } from "./compras";
import { livroDeEstoque, type LinhaLivro } from "./estoque";
import { custoRealDoLote, type CustoReal } from "./lotes";
import type {
  Apontamento,
  Componente,
  ComponenteFornecedor,
  Composicao,
  ComposicaoItem,
  Compra,
  CompraItem,
  CustoFabricacao,
  Empresa,
  Fornecedor,
  ID,
  Lote,
  LoteItem,
  Movimento,
  Produto,
  RegistroContagem,
} from "./tipos";

export interface BaseDados {
  empresa: Empresa;
  fornecedores: Fornecedor[];
  componentes: Componente[];
  componenteFornecedores: ComponenteFornecedor[];
  produtos: Produto[];
  composicoes: Composicao[];
  composicaoItens: ComposicaoItem[];
  movimentos: Movimento[];
  compras: Compra[];
  compraItens: CompraItem[];
  lotes: Lote[];
  loteItens: LoteItem[];
  custosFabricacao: CustoFabricacao[];
  apontamentos: Apontamento[];
  anexosPorRef: Map<string, number>; // "compra:ID" → quantidade de anexos
  mapaNFe?: Record<string, string>; // "CNPJ:código do produto na nota" → componente
  contagens?: RegistroContagem[];
}

// Já foi feita a contagem da transição MEI → ME? (registrada, ou pelos ajustes que ela gerou)
export const fezContagemDeTransicao = (base: Pick<BaseDados, "movimentos" | "contagens">) =>
  !!base.contagens?.some((c) => c.saldoInicial) || base.movimentos.some((m) => m.refTipo === "inventario" && m.tipo === "saldo_inicial");

export const fezAlgumaContagem = (base: Pick<BaseDados, "movimentos" | "contagens">) =>
  !!base.contagens?.length || base.movimentos.some((m) => m.refTipo === "inventario");

export const mapaPorId = <T extends { id: ID }>(lista: T[]) => new Map(lista.map((x) => [x.id, x]));

// ---------- Custo real dos lotes ----------

export function custosDosLotes(base: BaseDados, livro: LinhaLivro[] = livroDeEstoque(base.movimentos)): Map<ID, CustoReal> {
  const apontamentoLote = new Map(base.apontamentos.map((a) => [a.id, a.loteId]));
  const materiais = new Map<ID, number>();
  for (const l of livro) {
    const m = l.movimento;
    if (m.refTipo !== "apontamento" || !m.refId) continue;
    const loteId = apontamentoLote.get(m.refId);
    if (loteId) materiais.set(loteId, (materiais.get(loteId) ?? 0) - l.valor);
  }
  const componentes = mapaPorId(base.componentes);
  const r = new Map<ID, CustoReal>();
  for (const lote of base.lotes) {
    const diretos = base.compras
      .filter((c) => c.loteId === lote.id)
      .reduce((a, c) => a + custoDiretoDaCompra(c, base.compraItens.filter((i) => i.compraId === c.id), componentes), 0);
    r.set(
      lote.id,
      custoRealDoLote({
        materiais: materiais.get(lote.id) ?? 0,
        diretos,
        custos: base.custosFabricacao.filter((c) => c.loteId === lote.id),
        apontamentos: base.apontamentos.filter((a) => a.loteId === lote.id),
      }),
    );
  }
  return r;
}

// ---------- Compras do período ----------

export interface LinhaCompraRelatorio {
  compra: Compra;
  fornecedor?: Fornecedor;
  lote?: Lote;
  itens: { item: CompraItem; componente?: Componente; custoUnitario: number }[];
  produtos: number;
  adicionais: number;
  total: number;
  anexos: number;
}

const noPeriodo = (iso: string, de: string, ate: string) => iso >= de && iso <= ate;

export function comprasNoPeriodo(base: BaseDados, de: string, ate: string): LinhaCompraRelatorio[] {
  const fornecedores = mapaPorId(base.fornecedores);
  const componentes = mapaPorId(base.componentes);
  const lotes = mapaPorId(base.lotes);
  return base.compras
    .filter((c) => c.status !== "cancelada" && c.status !== "rascunho" && noPeriodo(c.data, de, ate))
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((compra) => {
      const itens = base.compraItens.filter((i) => i.compraId === compra.id);
      const custos = custosDeEntrada(compra, itens);
      const produtos = produtosDaCompra(itens);
      const adicionais = adicionaisDaCompra(compra);
      return {
        compra,
        fornecedor: compra.fornecedorId ? fornecedores.get(compra.fornecedorId) : undefined,
        lote: compra.loteId ? lotes.get(compra.loteId) : undefined,
        itens: itens.map((item) => ({ item, componente: componentes.get(item.componenteId), custoUnitario: custos.get(item.id)?.custoUnitario ?? 0 })),
        produtos,
        adicionais,
        total: produtos + adicionais,
        anexos: base.anexosPorRef.get(`compra:${compra.id}`) ?? 0,
      };
    });
}

// ---------- Movimentação e inventário ----------

export interface QtdValor {
  quantidade: number;
  valor: number;
}

export interface LinhaMovimentacao {
  componente: Componente;
  inicial: QtdValor;
  entradas: QtdValor;
  saidas: QtdValor; // valores positivos
  final: QtdValor;
}

const zero = (): QtdValor => ({ quantidade: 0, valor: 0 });

export function movimentacaoNoPeriodo(base: BaseDados, de: string, ate: string, livro: LinhaLivro[] = livroDeEstoque(base.movimentos)) {
  const componentes = mapaPorId(base.componentes);
  const linhas = new Map<ID, LinhaMovimentacao>();
  const linha = (id: ID) => {
    let l = linhas.get(id);
    if (!l) {
      const componente = componentes.get(id) ?? ({ id, nome: id, categoria: "Sem categoria", unidade: "un" } as Componente);
      l = { componente, inicial: zero(), entradas: zero(), saidas: zero(), final: zero() };
      linhas.set(id, l);
    }
    return l;
  };
  for (const x of livro) {
    const m = x.movimento;
    if (m.data > ate) continue;
    const l = linha(m.componenteId);
    if (m.data < de) {
      l.inicial = { quantidade: x.saldoQuantidade, valor: x.saldoValor };
    } else if (m.quantidade > 0) {
      l.entradas.quantidade += m.quantidade;
      l.entradas.valor += x.valor;
    } else {
      l.saidas.quantidade -= m.quantidade;
      l.saidas.valor -= x.valor;
    }
    l.final = { quantidade: x.saldoQuantidade, valor: x.saldoValor };
  }
  const lista = [...linhas.values()]
    .filter((l) => l.inicial.quantidade || l.entradas.quantidade || l.saidas.quantidade || l.final.quantidade)
    .sort(porCategoriaENome);
  const soma = (f: (l: LinhaMovimentacao) => QtdValor) => lista.reduce((a, l) => a + f(l).valor, 0);
  return {
    linhas: lista,
    totais: { inicial: soma((l) => l.inicial), entradas: soma((l) => l.entradas), saidas: soma((l) => l.saidas), final: soma((l) => l.final) },
    movimentos: livro.filter((x) => noPeriodo(x.movimento.data, de, ate)),
  };
}

const porCategoriaENome = (a: { componente: Componente }, b: { componente: Componente }) =>
  a.componente.categoria.localeCompare(b.componente.categoria, "pt-BR") || a.componente.nome.localeCompare(b.componente.nome, "pt-BR");

export interface LinhaInventario {
  componente: Componente;
  quantidade: number;
  custoMedio: number;
  valor: number;
}

// Posição do estoque numa data, valorizada pelo custo médio (base do Livro Registro de Inventário).
export function inventarioEm(base: BaseDados, ate: string, livro: LinhaLivro[] = livroDeEstoque(base.movimentos)) {
  const ultimo = new Map<ID, LinhaLivro>();
  for (const x of livro) if (x.movimento.data <= ate) ultimo.set(x.movimento.componenteId, x);
  const componentes = mapaPorId(base.componentes);
  const linhas: LinhaInventario[] = [];
  for (const [id, x] of ultimo) {
    const componente = componentes.get(id);
    if (!componente || x.saldoQuantidade === 0) continue;
    linhas.push({ componente, quantidade: x.saldoQuantidade, custoMedio: x.custoMedio, valor: x.saldoValor });
  }
  linhas.sort(porCategoriaENome);
  return { linhas, total: linhas.reduce((a, l) => a + l.valor, 0) };
}

// ---------- Produção do período ----------

export function producaoNoPeriodo(base: BaseDados, de: string, ate: string, custos: Map<ID, CustoReal> = custosDosLotes(base)) {
  const produtos = mapaPorId(base.produtos);
  const lotes = mapaPorId(base.lotes);
  const apontamentos = base.apontamentos
    .filter((a) => noPeriodo(a.data, de, ate))
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((a) => ({ apontamento: a, produto: produtos.get(a.produtoId), lote: lotes.get(a.loteId) }));
  const custosFabricacao = base.custosFabricacao
    .filter((c) => noPeriodo(c.data, de, ate))
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((c) => ({ custo: c, lote: lotes.get(c.loteId) }));
  const lotesConcluidos = base.lotes
    .filter((l) => l.status === "concluido" && l.concluidoEm && noPeriodo(l.concluidoEm, de, ate))
    .map((lote) => ({ lote, custo: custos.get(lote.id)!, itens: base.loteItens.filter((i) => i.loteId === lote.id).map((i) => ({ item: i, produto: produtos.get(i.produtoId) })) }));
  return {
    apontamentos,
    custosFabricacao,
    lotesConcluidos,
    pedaisBons: apontamentos.reduce((a, x) => a + x.apontamento.qtdBoa, 0),
    refugo: apontamentos.reduce((a, x) => a + x.apontamento.qtdRefugo, 0),
    totalCustos: custosFabricacao.reduce((a, x) => a + x.custo.valor, 0),
  };
}

// ---------- Pendências ----------

export interface Pendencia {
  id: string;
  gravidade: "alta" | "media" | "baixa";
  titulo: string;
  detalhe: string;
  quantidade: number;
  link: string;
}

// O que o contador vai perguntar. Sem período, olha tudo.
export function pendenciasFiscais(base: BaseDados, de = "", ate = "9999"): Pendencia[] {
  const p: Pendencia[] = [];
  const empresa = base.empresa;
  if (!empresa.cnpj || !empresa.regime) {
    p.push({ id: "empresa", gravidade: "alta", titulo: "Dados da empresa incompletos", detalhe: "CNPJ e regime tributário aparecem no cabeçalho dos relatórios.", quantidade: 1, link: "#/dados" });
  }
  const recebidas = base.compras.filter((c) => !c.legado && STATUS_COM_ENTRADA.includes(c.status) && noPeriodo(c.data, de, ate));
  const semDoc = recebidas.filter((c) => c.documentoTipo === "sem_documento");
  if (semDoc.length) {
    p.push({ id: "sem-doc", gravidade: "alta", titulo: "Compras recebidas sem documento fiscal", detalhe: "Sem nota, o custo da peça não tem comprovação para a contabilidade.", quantidade: semDoc.length, link: "#/compras?filtro=sem_documento" });
  }
  const nfeSemChave = recebidas.filter((c) => c.documentoTipo === "nfe" && !c.chaveNFe);
  if (nfeSemChave.length) {
    p.push({ id: "sem-chave", gravidade: "media", titulo: "NF-e sem chave de acesso", detalhe: "A chave de 44 dígitos permite ao contador conferir a nota na SEFAZ.", quantidade: nfeSemChave.length, link: "#/compras?filtro=sem_chave" });
  }
  const noCpf = recebidas.filter((c) => c.compradoEm === "cpf");
  if (noCpf.length) {
    p.push({ id: "cpf", gravidade: "media", titulo: "Compras feitas no CPF", detalhe: "Notas em nome da pessoa física não entram como custo da empresa sem orientação do contador.", quantidade: noCpf.length, link: "#/compras?filtro=cpf" });
  }
  const semAnexo = recebidas.filter((c) => c.documentoTipo !== "sem_documento" && !base.anexosPorRef.get(`compra:${c.id}`));
  if (semAnexo.length) {
    p.push({ id: "sem-anexo", gravidade: "baixa", titulo: "Notas sem o arquivo anexado", detalhe: "Anexe o PDF ou o XML para mandar junto no fechamento.", quantidade: semAnexo.length, link: "#/compras?filtro=sem_anexo" });
  }
  const comSaldo = new Set(base.movimentos.map((m) => m.componenteId));
  const estocaveis = base.componentes.filter((c) => c.controlaEstoque && (c.ativo || comSaldo.has(c.id)));
  const semNcm = estocaveis.filter((c) => !c.ncm);
  if (semNcm.length) {
    p.push({ id: "ncm", gravidade: "media", titulo: "Componentes sem NCM", detalhe: "O NCM classifica a peça no inventário e nas notas.", quantidade: semNcm.length, link: "#/componentes?filtro=sem_ncm" });
  }
  const semOrigem = estocaveis.filter((c) => !c.origem);
  if (semOrigem.length) {
    p.push({ id: "origem", gravidade: "baixa", titulo: "Componentes sem origem (nacional ou importado)", detalhe: "Define o código de origem da NF-e de venda do pedal.", quantidade: semOrigem.length, link: "#/componentes?filtro=sem_origem" });
  }
  if (empresa.dataTransicao && !fezContagemDeTransicao(base)) {
    p.push({ id: "contagem", gravidade: "alta", titulo: "Falta a contagem da transição MEI → ME", detalhe: "A contagem física na data de saída do MEI vira o saldo inicial oficial do estoque.", quantidade: 1, link: "#/estoque/contagem" });
  }
  const livro = livroDeEstoque(base.movimentos);
  const negativos = new Set<ID>();
  const final = new Map<ID, number>();
  for (const x of livro) if (x.movimento.data <= ate) final.set(x.movimento.componenteId, x.saldoQuantidade);
  for (const [id, q] of final) if (q < -1e-9) negativos.add(id);
  if (negativos.size) {
    p.push({ id: "negativo", gravidade: "alta", titulo: "Estoque negativo", detalhe: "Saiu mais do que entrou: falta lançar uma compra ou corrigir a contagem.", quantidade: negativos.size, link: "#/estoque?filtro=negativo" });
  }
  const ordem = { alta: 0, media: 1, baixa: 2 };
  return p.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
}

export type { CustoReal };
