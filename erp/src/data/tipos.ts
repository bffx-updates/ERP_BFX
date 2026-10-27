// Modelo de dados do BFX Technologies ERP.
// Valores em dinheiro são sempre em reais (number) e só são arredondados na exibição,
// porque custos unitários de peças compradas em pacote têm frações de centavo.
// Datas são strings ISO 8601.

export type ID = string;

export type ModoCobranca = "unidade" | "modelo" | "lote";
export type OrigemComponente = "nacional" | "importado";

export interface Fornecedor {
  id: ID;
  nome: string;
  tipo: "nacional" | "importacao";
  documento?: string; // CNPJ ou CPF
  pais?: string;
  site?: string;
  contato?: string;
  email?: string;
  telefone?: string;
  prazoDias?: number;
  obs?: string;
  ativo: boolean;
  criadoEm: string;
}

export interface Componente {
  id: ID;
  sku?: string;
  nome: string;
  categoria: string;
  variante?: string;
  unidade: string;
  estoqueMinimo: number;
  custoReferencia?: number; // usado no planejamento antes da primeira compra
  ncm?: string;
  origem?: OrigemComponente; // indefinida até ser conferida
  modoCobranca: ModoCobranca;
  controlaEstoque: boolean; // false para custos que não são peças físicas (ex.: frete lançado na composição)
  obs?: string;
  ativo: boolean;
  criadoEm: string;
}

export interface ComponenteFornecedor {
  id: ID;
  componenteId: ID;
  fornecedorId: ID;
  url?: string;
  precoRef?: number;
  loteMinimo?: number;
  preferido: boolean;
}

export interface Produto {
  id: ID;
  sku?: string;
  nome: string;
  imagem?: string; // data URL
  precoVenda: number;
  ncm?: string;
  cfop?: string;
  origemFiscal?: string; // código de origem da NF-e (0, 3, 5, 8…)
  tipo: "fabricacao" | "revenda";
  composicaoAtualId?: ID;
  ativo: boolean;
  criadoEm: string;
}

// Lista de peças versionada: lotes antigos continuam apontando para a versão que usaram.
export interface Composicao {
  id: ID;
  produtoId: ID;
  versao: number;
  criadaEm: string;
  obs?: string;
}

export interface ComposicaoItem {
  id: ID;
  composicaoId: ID;
  componenteId: ID;
  quantidade: number;
}

export type TipoMovimento =
  | "saldo_inicial"
  | "entrada_compra"
  | "consumo_producao"
  | "ajuste"
  | "perda"
  | "devolucao";

// Livro de estoque: o saldo e o custo médio saem da soma destes registros.
// Movimentos com refTipo compra/apontamento são gerados pelo app e refeitos quando a origem muda;
// os sem referência (ou "inventario") são lançados à mão.
export interface Movimento {
  id: ID;
  data: string;
  componenteId: ID;
  tipo: TipoMovimento;
  quantidade: number; // positivo = entrada, negativo = saída
  custoUnitario?: number; // entradas sem custo usam o custo médio vigente
  refTipo?: "compra" | "lote" | "inventario" | "importacao" | "apontamento";
  refId?: ID;
  obs?: string;
}

export type StatusCompra = "rascunho" | "pedido" | "em_transito" | "recebida_parcial" | "recebida" | "cancelada";
export type TipoDocumento = "nfe" | "nfce" | "importacao" | "recibo" | "sem_documento";

export interface Compra {
  id: ID;
  fornecedorId?: ID;
  data: string;
  recebidaEm?: string; // data em que as peças entraram no estoque (padrão: a data da compra)
  status: StatusCompra;
  documentoTipo: TipoDocumento;
  numeroNF?: string;
  serieNF?: string;
  chaveNFe?: string;
  compradoEm: "cnpj" | "cpf" | "nao_informado";
  frete: number;
  impostos: number;
  outrasDespesas: number;
  moeda: "BRL" | "USD" | "CNY" | "EUR";
  cambio?: number;
  loteId?: ID;
  legado?: boolean; // importada do app antigo: não gera movimento de estoque
  obs?: string;
}

export interface CompraItem {
  id: ID;
  compraId: ID;
  componenteId: ID;
  quantidade: number;
  valorTotal: number; // valor pago pelos produtos, sem frete/impostos
  qtdRecebida: number;
}

export type StatusLote = "planejado" | "comprando" | "em_producao" | "concluido" | "cancelado";

export interface Lote {
  id: ID;
  codigo: string;
  nome?: string;
  status: StatusLote;
  margemSobra: number; // %
  criadoEm: string;
  concluidoEm?: string;
  legado?: unknown; // snapshot bruto do app antigo
  obs?: string;
}

export interface LoteItem {
  id: ID;
  loteId: ID;
  produtoId: ID;
  composicaoId?: ID;
  qtdPlanejada: number;
  qtdProduzida: number | null; // null = não registrado
  qtdRefugo: number;
}

export type TipoCustoFabricacao =
  | "mao_de_obra"
  | "energia"
  | "consumiveis"
  | "terceirizado"
  | "rateio_fixo"
  | "outro";

export interface CustoFabricacao {
  id: ID;
  loteId: ID;
  data: string;
  tipo: TipoCustoFabricacao;
  descricao?: string;
  valor: number;
  horas?: number;
}

export interface Apontamento {
  id: ID;
  loteId: ID;
  produtoId: ID;
  data: string;
  qtdBoa: number;
  qtdRefugo: number;
  horas?: number;
  obs?: string;
}

export interface Anexo {
  id: ID;
  refTipo: "compra" | "lote" | "venda";
  refId: ID;
  nome: string;
  mime: string;
  tamanho: number;
  conteudo: Blob;
  criadoEm: string;
}

export interface ConfigItem {
  chave: string;
  valor: unknown;
}

export interface Empresa {
  nome: string;
  cnpj: string;
  regime: "" | "mei" | "me_simples" | "epp_simples" | "presumido" | "outro";
  dataTransicao: string; // data de saída do MEI (AAAA-MM-DD)
  razaoSocial?: string;
  inscricaoEstadual?: string;
  municipio?: string; // "Cidade/UF"
  contador?: string;
  contadorEmail?: string;
}

// Cada contagem física aplicada (config "contagens"), inclusive as que não acharam diferença.
export interface RegistroContagem {
  id: ID;
  dia: string; // AAAA-MM-DD
  saldoInicial: boolean; // contagem da transição MEI → ME
  itens: number;
  ajustes: number;
  registradaEm: string;
}

// Parâmetros de custo da produção (config "producao").
export interface ConfigProducao {
  valorHora: number; // mão de obra, R$ por hora
  margemPadrao: number; // % de sobra sugerida em lotes novos
}

// Estado interno do app (pasta de backup etc.). Nunca entra no backup.
export interface SistemaItem {
  chave: string;
  valor: unknown;
}
