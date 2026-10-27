// Consultas reativas: as telas se atualizam sozinhas quando os dados mudam.
// As telas leem por estes hooks e gravam pelas ações (acoes.ts), nunca direto no banco.
import { useLiveQuery } from "dexie-react-hooks";
import { db, lerConfig } from "./db";
import type { BaseDados } from "./relatorios";
import { calcularSaldos, capacidadeDeMontagem, situacao, type CapacidadeMontagem } from "./estoque";
import type { Anexo, Componente, ComposicaoItem, ConfigProducao, Empresa, Produto, RegistroContagem } from "./tipos";

export const EMPRESA_PADRAO: Empresa = { nome: "BFX Technologies", cnpj: "", regime: "", dataTransicao: "" };

// A empresa se chamava "BFFX". Quem salvou os dados com o nome antigo passa a ver o novo;
// o nome novo fica gravado na próxima vez que os dados da empresa forem salvos.
const NOME_ANTIGO = "BFFX";

async function lerEmpresa(): Promise<Empresa> {
  const empresa = { ...EMPRESA_PADRAO, ...(await lerConfig<Partial<Empresa>>("empresa", {})) };
  return empresa.nome === NOME_ANTIGO ? { ...empresa, nome: EMPRESA_PADRAO.nome } : empresa;
}

export function useEmpresa(): Empresa | undefined {
  return useLiveQuery(lerEmpresa);
}

export const PRODUCAO_PADRAO: ConfigProducao = { valorHora: 0, margemPadrao: 10 };

export function useConfigProducao(): ConfigProducao | undefined {
  return useLiveQuery(async () => {
    const legadoMargem = await lerConfig<number | undefined>("margemPadrao", undefined);
    const salvo = await lerConfig<Partial<ConfigProducao>>("producao", {});
    return { ...PRODUCAO_PADRAO, ...(legadoMargem != null ? { margemPadrao: legadoMargem } : {}), ...salvo };
  });
}

// Todas as tabelas de uma vez. Os dados de uma empresa pequena cabem com folga na memória,
// e as telas calculam o que precisam a partir daqui.
export function useBase(): BaseDados | undefined {
  return useLiveQuery(async () => {
    const [
      empresa,
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
      anexos,
      mapaNFe,
      contagens,
    ] = await Promise.all([
      lerEmpresa(),
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
      db.anexos.toArray(),
      lerConfig<Record<string, string>>("mapaNFe", {}),
      lerConfig<RegistroContagem[]>("contagens", []),
    ]);
    const anexosPorRef = new Map<string, number>();
    for (const a of anexos) anexosPorRef.set(`${a.refTipo}:${a.refId}`, (anexosPorRef.get(`${a.refTipo}:${a.refId}`) ?? 0) + 1);
    return {
      empresa,
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
      anexosPorRef,
      mapaNFe,
      contagens,
    };
  });
}

export function useAnexos(refTipo: Anexo["refTipo"], refId: string | undefined): Anexo[] | undefined {
  return useLiveQuery(async () => (refId ? db.anexos.where("[refTipo+refId]").equals([refTipo, refId]).toArray() : []), [refTipo, refId]);
}

export interface ItemComposicaoDetalhe {
  item: ComposicaoItem;
  componente?: Componente;
  custoUnitario: number;
}

export interface ProdutoDetalhe {
  produto: Produto;
  versao?: number;
  itens: ItemComposicaoDetalhe[];
  custoVariavel: number; // peças cobradas por unidade produzida
  custoFixo: number; // peças fixas por modelo/lote, diluídas no tamanho do lote
  capacidade: CapacidadeMontagem;
}

export function useProdutos(): ProdutoDetalhe[] | undefined {
  return useLiveQuery(async () => {
    const [produtos, composicoes, itens, componentes, movimentos] = await Promise.all([
      db.produtos.toArray(),
      db.composicoes.toArray(),
      db.composicaoItens.toArray(),
      db.componentes.toArray(),
      db.movimentos.toArray(),
    ]);
    const saldos = calcularSaldos(movimentos);
    const compPorId = new Map(componentes.map((c) => [c.id, c]));
    return produtos
      .filter((p) => p.ativo)
      .map((produto) => {
        const composicao = composicoes.find((c) => c.id === produto.composicaoAtualId);
        const detalhes = itens
          .filter((i) => i.composicaoId === produto.composicaoAtualId)
          .map((item) => {
            const componente = compPorId.get(item.componenteId);
            const custoUnitario = saldos.get(item.componenteId)?.custoMedio || componente?.custoReferencia || 0;
            return { item, componente, custoUnitario };
          })
          .sort((a, b) => (a.componente?.categoria ?? "").localeCompare(b.componente?.categoria ?? "", "pt-BR"));
        let custoVariavel = 0;
        let custoFixo = 0;
        for (const d of detalhes) {
          const v = d.item.quantidade * d.custoUnitario;
          if ((d.componente?.modoCobranca ?? "unidade") === "unidade") custoVariavel += v;
          else custoFixo += v;
        }
        const capacidade = capacidadeDeMontagem(
          detalhes
            .filter((d) => d.componente?.controlaEstoque)
            .map((d) => ({
              nome: d.componente!.nome,
              quantidade: d.item.quantidade,
              modo: d.componente!.modoCobranca,
              saldo: saldos.get(d.item.componenteId)?.quantidade ?? 0,
            })),
        );
        return { produto, versao: composicao?.versao, itens: detalhes, custoVariavel, custoFixo, capacidade };
      })
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome, "pt-BR"));
  });
}

export interface ResumoGeral {
  componentes: number;
  produtos: number;
  fornecedores: number;
  lotesAtivos: number;
  lotesConcluidos: number;
  valorEstoque: number;
  emFalta: number;
  vazio: boolean;
}

export function useResumo(): ResumoGeral | undefined {
  return useLiveQuery(async () => {
    const [componentes, produtos, fornecedores, lotes, movimentos] = await Promise.all([
      db.componentes.toArray(),
      db.produtos.toArray(),
      db.fornecedores.count(),
      db.lotes.toArray(),
      db.movimentos.toArray(),
    ]);
    const saldos = calcularSaldos(movimentos);
    const ativos = componentes.filter((c) => c.ativo && c.controlaEstoque);
    let valorEstoque = 0;
    for (const s of saldos.values()) valorEstoque += s.valor;
    return {
      componentes: ativos.length,
      produtos: produtos.filter((p) => p.ativo).length,
      fornecedores,
      lotesAtivos: lotes.filter((l) => l.status !== "concluido" && l.status !== "cancelado").length,
      lotesConcluidos: lotes.filter((l) => l.status === "concluido").length,
      valorEstoque,
      emFalta: ativos.filter((c) => situacao(saldos.get(c.id)?.quantidade ?? 0, c.estoqueMinimo) !== "ok").length,
      vazio: componentes.length === 0 && produtos.length === 0,
    };
  });
}
