// Tudo que altera os dados passa por aqui. Cada ação roda numa transação: ou grava tudo, ou nada.
// Movimentos de estoque que dependem de outra coisa (compra recebida, produção apontada) são
// refeitos a partir da origem sempre que ela muda, então o livro de estoque nunca fica desatualizado.
import { movimentosDaCompra } from "./compras";
import { db, salvarConfig, uid } from "./db";
import { calcularSaldos, importadoDepois } from "./estoque";
import { data, fimDoDiaIso, soDocumento } from "./formato";
import { composicaoDoItem, movimentosDeConsumo } from "./lotes";
import type {
  Anexo,
  Apontamento,
  Componente,
  ComponenteFornecedor,
  Compra,
  CompraItem,
  ConfigProducao,
  CustoFabricacao,
  Fornecedor,
  ID,
  Lote,
  LoteItem,
  Movimento,
  Produto,
  RegistroContagem,
  StatusLote,
  TipoMovimento,
} from "./tipos";

const agora = () => new Date().toISOString();

export class AcaoBloqueada extends Error {}

// ---------- Fornecedores ----------

export type FornecedorEditavel = Omit<Fornecedor, "id" | "criadoEm"> & { id?: ID; criadoEm?: string };

export async function salvarFornecedor(f: FornecedorEditavel): Promise<ID> {
  const registro: Fornecedor = { ...f, id: f.id ?? uid("forn"), criadoEm: f.criadoEm ?? agora(), nome: f.nome.trim() };
  await db.fornecedores.put(registro);
  return registro.id;
}

export async function excluirFornecedor(id: ID): Promise<void> {
  const compras = await db.compras.where("fornecedorId").equals(id).count();
  if (compras) throw new AcaoBloqueada("Este fornecedor tem compras registradas. Desative-o em vez de excluir.");
  await db.transaction("rw", db.fornecedores, db.componenteFornecedores, async () => {
    await db.componenteFornecedores.where("fornecedorId").equals(id).delete();
    await db.fornecedores.delete(id);
  });
}

// ---------- Componentes ----------

export type ComponenteEditavel = Omit<Componente, "id" | "criadoEm"> & { id?: ID; criadoEm?: string };
export type VinculoEditavel = Omit<ComponenteFornecedor, "id" | "componenteId"> & { id?: ID };

export async function salvarComponente(c: ComponenteEditavel, vinculos: VinculoEditavel[]): Promise<ID> {
  const id = c.id ?? uid("comp");
  const registro: Componente = { ...c, id, criadoEm: c.criadoEm ?? agora(), nome: c.nome.trim(), categoria: c.categoria.trim() || "Sem categoria" };
  const temPreferido = vinculos.some((v) => v.preferido);
  const novos: ComponenteFornecedor[] = vinculos
    .filter((v) => v.fornecedorId)
    .map((v, i) => ({ ...v, id: v.id ?? uid("cf"), componenteId: id, preferido: temPreferido ? v.preferido : i === 0 }));
  await db.transaction("rw", db.componentes, db.componenteFornecedores, async () => {
    await db.componentes.put(registro);
    const manter = new Set(novos.map((v) => v.id));
    const antigos = await db.componenteFornecedores.where("componenteId").equals(id).toArray();
    await db.componenteFornecedores.bulkDelete(antigos.filter((v) => !manter.has(v.id)).map((v) => v.id));
    await db.componenteFornecedores.bulkPut(novos);
  });
  return id;
}

export async function usoDoComponente(id: ID): Promise<{ movimentos: number; compras: number; produtos: number }> {
  const [movimentos, compras, itens] = await Promise.all([
    db.movimentos.where("componenteId").equals(id).count(),
    db.compraItens.where("componenteId").equals(id).count(),
    db.composicaoItens.where("componenteId").equals(id).toArray(),
  ]);
  return { movimentos, compras, produtos: new Set(itens.map((i) => i.composicaoId)).size };
}

export async function excluirComponente(id: ID): Promise<void> {
  const uso = await usoDoComponente(id);
  if (uso.movimentos || uso.compras || uso.produtos) {
    throw new AcaoBloqueada("Este componente aparece em compras, no estoque ou na composição de um produto. Desative-o em vez de excluir.");
  }
  await db.transaction("rw", db.componentes, db.componenteFornecedores, async () => {
    await db.componenteFornecedores.where("componenteId").equals(id).delete();
    await db.componentes.delete(id);
  });
}

// ---------- Produtos e composição ----------

export type ProdutoEditavel = Omit<Produto, "id" | "criadoEm" | "composicaoAtualId"> & { id?: ID; criadoEm?: string; composicaoAtualId?: ID };
export interface ItemComposicaoEditavel {
  componenteId: ID;
  quantidade: number;
}

const assinatura = (itens: ItemComposicaoEditavel[]) =>
  itens
    .filter((i) => i.quantidade > 0)
    .map((i) => `${i.componenteId}:${i.quantidade}`)
    .sort()
    .join("|");

// Mudou a lista de peças? Vira uma versão nova; lotes antigos continuam apontando para a deles.
export async function salvarProduto(p: ProdutoEditavel, itens: ItemComposicaoEditavel[], obsVersao?: string): Promise<{ id: ID; novaVersao?: number }> {
  const id = p.id ?? uid("prod");
  let novaVersao: number | undefined;
  await db.transaction("rw", db.produtos, db.composicoes, db.composicaoItens, async () => {
    const atuais = p.composicaoAtualId ? await db.composicaoItens.where("composicaoId").equals(p.composicaoAtualId).toArray() : [];
    let composicaoAtualId = p.composicaoAtualId;
    const validos = itens.filter((i) => i.componenteId && i.quantidade > 0);
    if (!composicaoAtualId || assinatura(validos) !== assinatura(atuais)) {
      const versoes = await db.composicoes.where("produtoId").equals(id).toArray();
      novaVersao = versoes.reduce((m, v) => Math.max(m, v.versao), 0) + 1;
      composicaoAtualId = uid("compo");
      await db.composicoes.put({ id: composicaoAtualId, produtoId: id, versao: novaVersao, criadaEm: agora(), obs: obsVersao });
      // A mesma peça duas vezes vira uma linha só.
      const somados = new Map<ID, number>();
      for (const i of validos) somados.set(i.componenteId, (somados.get(i.componenteId) ?? 0) + i.quantidade);
      await db.composicaoItens.bulkPut(
        [...somados].map(([componenteId, quantidade]) => ({ id: uid("ci"), composicaoId: composicaoAtualId!, componenteId, quantidade })),
      );
    }
    await db.produtos.put({ ...p, id, criadoEm: p.criadoEm ?? agora(), nome: p.nome.trim(), composicaoAtualId });
  });
  return { id, novaVersao };
}

export async function excluirProduto(id: ID): Promise<void> {
  const [lotes, apontamentos] = await Promise.all([db.loteItens.filter((i) => i.produtoId === id).count(), db.apontamentos.filter((a) => a.produtoId === id).count()]);
  if (lotes || apontamentos) throw new AcaoBloqueada("Este produto já foi usado em lotes. Desative-o em vez de excluir.");
  await db.transaction("rw", db.produtos, db.composicoes, db.composicaoItens, async () => {
    const versoes = await db.composicoes.where("produtoId").equals(id).toArray();
    for (const v of versoes) await db.composicaoItens.where("composicaoId").equals(v.id).delete();
    await db.composicoes.where("produtoId").equals(id).delete();
    await db.produtos.delete(id);
  });
}

// ---------- Compras ----------

export type CompraEditavel = Omit<Compra, "id"> & { id?: ID };
export type ItemCompraEditavel = Omit<CompraItem, "id" | "compraId"> & { id?: ID };

async function refazerMovimentosDaCompra(compra: Compra, itens: CompraItem[]) {
  const componentes = new Map((await db.componentes.toArray()).map((c) => [c.id, c]));
  const novos = movimentosDaCompra(compra, itens, componentes);
  const manter = new Set(novos.map((m) => m.id));
  const antigos = await db.movimentos.where("[refTipo+refId]").equals(["compra", compra.id]).toArray();
  await db.movimentos.bulkDelete(antigos.filter((m) => !manter.has(m.id)).map((m) => m.id));
  await db.movimentos.bulkPut(novos);
}

export async function salvarCompra(c: CompraEditavel, itens: ItemCompraEditavel[]): Promise<ID> {
  const id = c.id ?? uid("cp");
  const compra: Compra = { ...c, id };
  if (compra.status !== "recebida_parcial" && compra.status !== "recebida") delete compra.recebidaEm;
  const registros: CompraItem[] = itens
    .filter((i) => i.componenteId)
    .map((i) => ({
      ...i,
      id: i.id ?? uid("cpi"),
      compraId: id,
      qtdRecebida: compra.status === "recebida" ? i.quantidade : compra.status === "recebida_parcial" ? Math.min(i.qtdRecebida || 0, i.quantidade) : 0,
    }));
  await db.transaction("rw", [db.compras, db.compraItens, db.movimentos, db.componentes], async () => {
    const chave = soDocumento(compra.chaveNFe);
    if (chave) {
      const repetida = await db.compras.filter((x) => x.id !== id && soDocumento(x.chaveNFe) === chave).first();
      if (repetida) throw new AcaoBloqueada(`Esta NF-e já foi lançada na compra de ${data(repetida.data)}. Abra aquela compra em vez de lançar de novo.`);
    }
    await db.compras.put(compra);
    const manter = new Set(registros.map((i) => i.id));
    const antigos = await db.compraItens.where("compraId").equals(id).toArray();
    await db.compraItens.bulkDelete(antigos.filter((i) => !manter.has(i.id)).map((i) => i.id));
    await db.compraItens.bulkPut(registros);
    await refazerMovimentosDaCompra(compra, registros);
  });
  return id;
}

export async function excluirCompra(id: ID): Promise<void> {
  await db.transaction("rw", [db.compras, db.compraItens, db.movimentos, db.anexos], async () => {
    await db.movimentos.where("[refTipo+refId]").equals(["compra", id]).delete();
    await db.anexos.where("[refTipo+refId]").equals(["compra", id]).delete();
    await db.compraItens.where("compraId").equals(id).delete();
    await db.compras.delete(id);
  });
}

// ---------- Anexos ----------

export async function anexarArquivo(refTipo: Anexo["refTipo"], refId: ID, arquivo: File): Promise<ID> {
  const anexo: Anexo = {
    id: uid("anx"),
    refTipo,
    refId,
    nome: arquivo.name,
    mime: arquivo.type || "application/octet-stream",
    tamanho: arquivo.size,
    conteudo: arquivo,
    criadoEm: agora(),
  };
  await db.anexos.put(anexo);
  return anexo.id;
}

export async function removerAnexo(id: ID): Promise<void> {
  await db.anexos.delete(id);
}

// ---------- Estoque ----------

export interface LancamentoManual {
  componenteId: ID;
  tipo: Extract<TipoMovimento, "ajuste" | "perda" | "devolucao" | "saldo_inicial">;
  quantidade: number; // com sinal
  custoUnitario?: number;
  data: string;
  obs?: string;
}

export async function lancarMovimento(l: LancamentoManual): Promise<ID> {
  if (!l.quantidade) throw new AcaoBloqueada("Informe uma quantidade diferente de zero.");
  const m: Movimento = {
    id: uid("mov"),
    data: l.data,
    componenteId: l.componenteId,
    tipo: l.tipo,
    quantidade: l.quantidade,
    custoUnitario: l.quantidade > 0 && l.custoUnitario != null && l.custoUnitario > 0 ? l.custoUnitario : undefined,
    obs: l.obs?.trim() || undefined,
  };
  await db.movimentos.put(m);
  return m.id;
}

// Só movimentos lançados à mão podem ser excluídos; os outros saem quando a origem muda.
export function movimentoManual(m: Pick<Movimento, "refTipo">): boolean {
  return !m.refTipo || m.refTipo === "inventario";
}

export async function excluirMovimento(id: ID): Promise<void> {
  const m = await db.movimentos.get(id);
  if (!m) return;
  if (!movimentoManual(m)) throw new AcaoBloqueada("Este movimento vem de uma compra ou da produção. Altere a origem para mudá-lo.");
  await db.movimentos.delete(id);
}

export interface ContagemItem {
  componenteId: ID;
  contado: number;
}

// Contagem física: a diferença entre o contado e o saldo do sistema vira um ajuste.
// Na transição MEI → ME, os ajustes são marcados como saldo inicial, e o saldo importado do
// app antigo com data posterior à contagem é substituído por ela (senão contaria duas vezes).
export async function aplicarContagem(dia: string, contagens: ContagemItem[], saldoInicial: boolean): Promise<{ ajustes: number }> {
  const data = fimDoDiaIso(dia);
  const contagemId = uid("cont");
  let ajustes = 0;
  await db.transaction("rw", db.movimentos, db.componentes, db.config, async () => {
    const [todos, componentes] = await Promise.all([db.movimentos.toArray(), db.componentes.toArray()]);
    // Só das peças contadas: as que ficaram em branco mantêm o saldo que veio do app antigo.
    const contadas = new Set(contagens.map((c) => c.componenteId));
    const substituidos = saldoInicial ? todos.filter((m) => contadas.has(m.componenteId) && importadoDepois(m, data)) : [];
    const custoImportado = new Map(substituidos.map((m) => [m.componenteId, m.custoUnitario]));
    await db.movimentos.bulkDelete(substituidos.map((m) => m.id));
    const removidos = new Set(substituidos.map((m) => m.id));
    const movimentos = todos.filter((m) => !removidos.has(m.id));
    const saldos = calcularSaldos(movimentos.filter((m) => m.data <= data));
    const porId = new Map(componentes.map((c) => [c.id, c]));
    const novos: Movimento[] = [];
    for (const c of contagens) {
      const saldo = saldos.get(c.componenteId);
      const diferenca = Math.round((c.contado - (saldo?.quantidade ?? 0)) * 1e6) / 1e6;
      if (!diferenca) continue;
      const custo = saldo?.custoMedio || custoImportado.get(c.componenteId) || porId.get(c.componenteId)?.custoReferencia || undefined;
      novos.push({
        id: uid("mov"),
        data,
        componenteId: c.componenteId,
        tipo: saldoInicial ? "saldo_inicial" : "ajuste",
        quantidade: diferenca,
        custoUnitario: diferenca > 0 ? custo : undefined,
        refTipo: "inventario",
        refId: contagemId,
        obs: saldoInicial ? "Contagem da transição MEI → ME" : "Contagem física",
      });
    }
    await db.movimentos.bulkPut(novos);
    ajustes = novos.length;
    // A contagem fica registrada mesmo sem diferenças: "contou e bateu" também é informação.
    const registro: RegistroContagem = { id: contagemId, dia, saldoInicial, itens: contagens.length, ajustes, registradaEm: agora() };
    const anteriores = ((await db.config.get("contagens"))?.valor as RegistroContagem[] | undefined) ?? [];
    await db.config.put({ chave: "contagens", valor: [...anteriores, registro] });
  });
  return { ajustes };
}

// ---------- Lotes ----------

export type LoteEditavel = Omit<Lote, "id" | "criadoEm"> & { id?: ID; criadoEm?: string };
export type ItemLoteEditavel = Pick<LoteItem, "produtoId" | "qtdPlanejada"> & Partial<LoteItem>;

export async function salvarLote(l: LoteEditavel, itens: ItemLoteEditavel[]): Promise<ID> {
  const id = l.id ?? uid("lote");
  await db.transaction("rw", [db.lotes, db.loteItens, db.produtos, db.apontamentos], async () => {
    const produtos = new Map((await db.produtos.toArray()).map((p) => [p.id, p]));
    const antigos = await db.loteItens.where("loteId").equals(id).toArray();
    const produzidos = new Set((await db.apontamentos.where("loteId").equals(id).toArray()).map((a) => a.produtoId));
    const registros: LoteItem[] = itens
      .filter((i) => i.produtoId && i.qtdPlanejada > 0)
      .map((i) => {
        const antigo = antigos.find((a) => a.produtoId === i.produtoId);
        return {
          id: antigo?.id ?? i.id ?? uid("li"),
          loteId: id,
          produtoId: i.produtoId,
          // A composição fica congelada no lote a partir do momento em que ele é criado.
          composicaoId: antigo?.composicaoId ?? i.composicaoId ?? produtos.get(i.produtoId)?.composicaoAtualId,
          qtdPlanejada: i.qtdPlanejada,
          qtdProduzida: antigo?.qtdProduzida ?? null,
          qtdRefugo: antigo?.qtdRefugo ?? 0,
        };
      });
    // Modelo que já tem produção registrada nunca sai do lote: ele guarda a composição usada
    // e o que foi produzido. Tirado do plano, fica com 0 planejado.
    for (const a of antigos) {
      if (registros.some((r) => r.id === a.id) || !(produzidos.has(a.produtoId) || a.qtdProduzida != null)) continue;
      registros.push({ ...a, qtdPlanejada: 0 });
    }
    const manter = new Set(registros.map((r) => r.id));
    await db.loteItens.bulkDelete(antigos.filter((a) => !manter.has(a.id)).map((a) => a.id));
    await db.loteItens.bulkPut(registros);
    await db.lotes.put({ ...l, id, criadoEm: l.criadoEm ?? agora() });
  });
  return id;
}

export async function mudarStatusDoLote(id: ID, status: StatusLote): Promise<void> {
  const lote = await db.lotes.get(id);
  if (!lote) return;
  await db.lotes.put({ ...lote, status, concluidoEm: status === "concluido" ? (lote.concluidoEm ?? agora()) : undefined });
}

export async function excluirLote(id: ID): Promise<void> {
  const [compras, apontamentos] = await Promise.all([db.compras.where("loteId").equals(id).count(), db.apontamentos.where("loteId").equals(id).count()]);
  if (compras || apontamentos) throw new AcaoBloqueada("O lote tem compras ou produção registradas. Cancele-o em vez de excluir.");
  await db.transaction("rw", [db.lotes, db.loteItens, db.custosFabricacao], async () => {
    await db.loteItens.where("loteId").equals(id).delete();
    await db.custosFabricacao.where("loteId").equals(id).delete();
    await db.lotes.delete(id);
  });
}

export interface LinhaPedido {
  componenteId: ID;
  quantidade: number;
  fornecedorId?: ID;
  precoUnitario: number;
}

// Um pedido de compra por fornecedor, já vinculado ao lote.
export async function gerarPedidos(loteId: ID, linhas: LinhaPedido[], dia: string): Promise<ID[]> {
  const grupos = new Map<string, LinhaPedido[]>();
  for (const l of linhas.filter((x) => x.quantidade > 0)) {
    const chave = l.fornecedorId ?? "";
    grupos.set(chave, [...(grupos.get(chave) ?? []), l]);
  }
  const ids: ID[] = [];
  await db.transaction("rw", [db.compras, db.compraItens, db.lotes], async () => {
    for (const [fornecedorId, itens] of grupos) {
      const compraId = uid("cp");
      ids.push(compraId);
      await db.compras.put({
        id: compraId,
        fornecedorId: fornecedorId || undefined,
        data: dia,
        status: "pedido",
        documentoTipo: "nfe",
        compradoEm: "cnpj",
        frete: 0,
        impostos: 0,
        outrasDespesas: 0,
        moeda: "BRL",
        loteId,
        obs: "Gerado pelo planejamento do lote",
      });
      await db.compraItens.bulkPut(
        itens.map((i) => ({
          id: uid("cpi"),
          compraId,
          componenteId: i.componenteId,
          quantidade: i.quantidade,
          valorTotal: Math.round(i.quantidade * i.precoUnitario * 100) / 100,
          qtdRecebida: 0,
        })),
      );
    }
    const lote = await db.lotes.get(loteId);
    if (lote && lote.status === "planejado") await db.lotes.put({ ...lote, status: "comprando" });
  });
  return ids;
}

// ---------- Produção ----------

export const idCustoDoApontamento = (apontamentoId: ID) => `cf_ap_${apontamentoId}`;

async function refazerProducaoDoLote(loteId: ID) {
  const [lote, apontamentos, itens, produtos, componentes, composicaoItens] = await Promise.all([
    db.lotes.get(loteId),
    db.apontamentos.where("loteId").equals(loteId).toArray(),
    db.loteItens.where("loteId").equals(loteId).toArray(),
    db.produtos.toArray(),
    db.componentes.toArray(),
    db.composicaoItens.toArray(),
  ]);
  if (!lote) return;
  const mapaProdutos = new Map(produtos.map((p) => [p.id, p]));
  const novos = movimentosDeConsumo({
    lote,
    apontamentos,
    itens,
    produtos: mapaProdutos,
    composicaoItens,
    componentes: new Map(componentes.map((c) => [c.id, c])),
  });
  const antigos = apontamentos.length
    ? await db.movimentos
        .where("[refTipo+refId]")
        .anyOf(apontamentos.map((a) => ["apontamento", a.id]))
        .toArray()
    : [];
  const manter = new Set(novos.map((m) => m.id));
  await db.movimentos.bulkDelete(antigos.filter((m) => !manter.has(m.id)).map((m) => m.id));
  await db.movimentos.bulkPut(novos);

  // O lote guarda o total produzido de cada modelo; um modelo apontado fora do plano entra no lote.
  const porProduto = new Map<ID, { boa: number; refugo: number }>();
  for (const a of apontamentos) {
    const t = porProduto.get(a.produtoId) ?? { boa: 0, refugo: 0 };
    t.boa += Number(a.qtdBoa) || 0;
    t.refugo += Number(a.qtdRefugo) || 0;
    porProduto.set(a.produtoId, t);
  }
  const atualizados: LoteItem[] = itens.map((i) => {
    const t = porProduto.get(i.produtoId);
    if (t) return { ...i, qtdProduzida: t.boa, qtdRefugo: t.refugo };
    // Sem apontamentos o lote volta a "não registrado" (como os lotes do app antigo).
    return { ...i, qtdProduzida: apontamentos.length ? 0 : null, qtdRefugo: 0 };
  });
  for (const [produtoId, t] of porProduto) {
    if (itens.some((i) => i.produtoId === produtoId)) continue;
    atualizados.push({
      id: uid("li"),
      loteId,
      produtoId,
      composicaoId: composicaoDoItem({ produtoId }, mapaProdutos),
      qtdPlanejada: 0,
      qtdProduzida: t.boa,
      qtdRefugo: t.refugo,
    });
  }
  await db.loteItens.bulkPut(atualizados);
  if (apontamentos.length && (lote.status === "planejado" || lote.status === "comprando")) await db.lotes.put({ ...lote, status: "em_producao" });
}

export type ApontamentoEditavel = Omit<Apontamento, "id"> & { id?: ID };

const TABELAS_PRODUCAO = [db.apontamentos, db.movimentos, db.loteItens, db.lotes, db.produtos, db.componentes, db.composicaoItens, db.custosFabricacao];

// Registrar produção baixa as peças do estoque e, com horas e valor da hora, lança a mão de obra.
export async function salvarApontamento(a: ApontamentoEditavel, valorHora: number): Promise<ID> {
  const id = a.id ?? uid("ap");
  const registro: Apontamento = { ...a, id, obs: a.obs?.trim() || undefined };
  await db.transaction("rw", TABELAS_PRODUCAO, async () => {
    await db.apontamentos.put(registro);
    const custoId = idCustoDoApontamento(id);
    const horas = Number(registro.horas) || 0;
    const custoAnterior = await db.custosFabricacao.get(custoId);
    // Um registro já lançado mantém o valor da hora da época; o valor atual vale para os novos.
    const taxa = custoAnterior?.horas ? custoAnterior.valor / custoAnterior.horas : valorHora;
    if (horas > 0 && taxa > 0) {
      const produto = await db.produtos.get(registro.produtoId);
      await db.custosFabricacao.put({
        id: custoId,
        loteId: registro.loteId,
        data: registro.data,
        tipo: "mao_de_obra",
        descricao: `Montagem de ${registro.qtdBoa + registro.qtdRefugo}× ${produto?.nome ?? "pedal"}`,
        horas,
        valor: Math.round(horas * taxa * 100) / 100,
      });
    } else if (!horas) {
      await db.custosFabricacao.delete(custoId);
    }
    await refazerProducaoDoLote(registro.loteId);
  });
  return id;
}

export async function excluirApontamento(id: ID): Promise<void> {
  await db.transaction("rw", TABELAS_PRODUCAO, async () => {
    const a = await db.apontamentos.get(id);
    if (!a) return;
    await db.apontamentos.delete(id);
    await db.custosFabricacao.delete(idCustoDoApontamento(id));
    await db.movimentos.where("[refTipo+refId]").equals(["apontamento", id]).delete();
    await refazerProducaoDoLote(a.loteId);
  });
}

export type CustoEditavel = Omit<CustoFabricacao, "id"> & { id?: ID };

export async function salvarCustoFabricacao(c: CustoEditavel): Promise<ID> {
  const id = c.id ?? uid("cf");
  await db.custosFabricacao.put({ ...c, id, descricao: c.descricao?.trim() || undefined });
  return id;
}

export async function excluirCustoFabricacao(id: ID): Promise<void> {
  await db.custosFabricacao.delete(id);
}

export async function salvarConfigProducao(c: ConfigProducao): Promise<void> {
  await salvarConfig("producao", c);
}
