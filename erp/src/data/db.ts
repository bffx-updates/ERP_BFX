import Dexie, { type EntityTable } from "dexie";
import { DEMO } from "../demo";
import type {
  Anexo,
  Apontamento,
  Componente,
  ComponenteFornecedor,
  Composicao,
  ComposicaoItem,
  Compra,
  CompraItem,
  ConfigItem,
  CustoFabricacao,
  Fornecedor,
  Lote,
  LoteItem,
  Movimento,
  Produto,
  SistemaItem,
} from "./tipos";

export class BffxDB extends Dexie {
  fornecedores!: EntityTable<Fornecedor, "id">;
  componentes!: EntityTable<Componente, "id">;
  componenteFornecedores!: EntityTable<ComponenteFornecedor, "id">;
  produtos!: EntityTable<Produto, "id">;
  composicoes!: EntityTable<Composicao, "id">;
  composicaoItens!: EntityTable<ComposicaoItem, "id">;
  movimentos!: EntityTable<Movimento, "id">;
  compras!: EntityTable<Compra, "id">;
  compraItens!: EntityTable<CompraItem, "id">;
  lotes!: EntityTable<Lote, "id">;
  loteItens!: EntityTable<LoteItem, "id">;
  custosFabricacao!: EntityTable<CustoFabricacao, "id">;
  apontamentos!: EntityTable<Apontamento, "id">;
  anexos!: EntityTable<Anexo, "id">;
  config!: EntityTable<ConfigItem, "chave">;
  sistema!: EntityTable<SistemaItem, "chave">;

  constructor() {
    // A demonstração usa outro banco: nada do que se faz nela toca nos dados reais.
    super(DEMO ? "bffx-erp-demo" : "bffx-erp");
    this.version(1).stores({
      fornecedores: "id, nome",
      componentes: "id, nome, categoria",
      componenteFornecedores: "id, componenteId, fornecedorId",
      produtos: "id, nome",
      composicoes: "id, produtoId",
      composicaoItens: "id, composicaoId, componenteId",
      movimentos: "id, data, componenteId, tipo, [refTipo+refId]",
      compras: "id, data, fornecedorId, status, loteId",
      compraItens: "id, compraId, componenteId",
      lotes: "id, codigo, status, criadoEm",
      loteItens: "id, loteId, produtoId",
      custosFabricacao: "id, loteId, data",
      apontamentos: "id, loteId, data",
      anexos: "id, [refTipo+refId]",
      config: "chave",
      sistema: "chave",
    });
  }
}

export const db = new BffxDB();

// Tabelas com dados da empresa: entram no backup, na restauração e na importação.
export const TABELAS_DADOS = [
  "fornecedores",
  "componentes",
  "componenteFornecedores",
  "produtos",
  "composicoes",
  "composicaoItens",
  "movimentos",
  "compras",
  "compraItens",
  "lotes",
  "loteItens",
  "custosFabricacao",
  "apontamentos",
  "anexos",
  "config",
] as const;

export type TabelaDados = (typeof TABELAS_DADOS)[number];

export function tabela(nome: TabelaDados) {
  return db.table(nome);
}

export function uid(prefixo: string): string {
  const aleatorio =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefixo}_${aleatorio}`;
}

// Quantos registros de negócio existem (configurações não contam como "ter dados").
export async function contarDadosDaEmpresa(): Promise<number> {
  const contagens = await Promise.all([
    db.fornecedores.count(),
    db.componentes.count(),
    db.produtos.count(),
    db.movimentos.count(),
    db.compras.count(),
    db.lotes.count(),
  ]);
  return contagens.reduce((a, n) => a + n, 0);
}

export async function lerConfig<T>(chave: string, padrao: T): Promise<T> {
  const item = await db.config.get(chave);
  return item ? (item.valor as T) : padrao;
}

export async function salvarConfig(chave: string, valor: unknown): Promise<void> {
  await db.config.put({ chave, valor });
}

export async function lerSistema<T>(chave: string): Promise<T | undefined> {
  const item = await db.sistema.get(chave);
  return item?.valor as T | undefined;
}

export async function salvarSistema(chave: string, valor: unknown): Promise<void> {
  await db.sistema.put({ chave, valor });
}
