const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const dataCurta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dataHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const moedaFina = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const porcento = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export const brl = (n: number | undefined | null) => moeda.format(Number(n) || 0);
export const num = (n: number | undefined | null) => numero.format(Number(n) || 0);
// Custo unitário: peças baratas compradas em pacote têm frações de centavo que importam.
export const brlUnit = (n: number | undefined | null) => moedaFina.format(Number(n) || 0);
export const pct = (fracao: number) => porcento.format(fracao);

// ---------- Números digitados ----------

// Aceita "1.234,56", "1234,56", "1234.56" e "1,5". Vazio ou inválido → null.
export function lerNumero(texto: string | undefined | null): number | null {
  if (texto == null) return null;
  let s = String(texto).trim().replace(/\s|R\$/g, "");
  if (!s) return null;
  const virgula = s.lastIndexOf(",");
  const ponto = s.lastIndexOf(".");
  if (virgula >= 0 && ponto >= 0) {
    // O separador que aparece por último é o decimal.
    s = virgula > ponto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (virgula >= 0) {
    s = s.replace(",", ".");
  } else if (ponto >= 0 && /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.234" é milhar; "0.500" não
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Número para um campo de texto, com vírgula decimal e sem separador de milhar.
export function paraEntrada(n: number | undefined | null, casas?: number): string {
  if (n == null || !Number.isFinite(n)) return "";
  const s = casas == null ? String(Math.round(n * 1e6) / 1e6) : n.toFixed(casas);
  return s.replace(".", ",");
}

// ---------- Datas ----------

const doisDigitos = (n: number) => String(n).padStart(2, "0");

// AAAA-MM-DD no fuso do computador.
export function diaLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

export const hoje = () => diaLocal();

// Mês (AAAA-MM) de uma data ISO no fuso do computador. Datas são gravadas em UTC: uma contagem
// no fim do dia 31/10 fica "2026-11-01T02:59Z" e precisa contar em outubro.
export const mesLocal = (iso: string) => isoParaDia(iso).slice(0, 7);
export const anoLocal = (iso: string) => isoParaDia(iso).slice(0, 4);

// "2026-09-15T…" → "2026-09-15" (no fuso local), para campos de data.
export function isoParaDia(iso: string | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : diaLocal(d);
}

// "2026-09-15" → ISO ao meio-dia local, para a data não "voltar um dia" em outro fuso.
export function diaParaIso(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, (m || 1) - 1, d || 1, 12, 0, 0).toISOString();
}

// Fim do dia local, para filtros "até".
export function fimDoDiaIso(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, (m || 1) - 1, d || 1, 23, 59, 59, 999).toISOString();
}

export function inicioDoDiaIso(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, (m || 1) - 1, d || 1, 0, 0, 0, 0).toISOString();
}

const nomesMeses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${nomesMeses[(m || 1) - 1]} de ${a}`;
}

export function limitesDoMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return { de: `${mes}-01`, ate: `${mes}-${doisDigitos(ultimo)}` };
}

export function mesAnterior(d: Date = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${x.getFullYear()}-${doisDigitos(x.getMonth() + 1)}`;
}

export function mesDe(d: Date = new Date()): string {
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}`;
}

export function periodoPorExtenso(de: string, ate: string): string {
  const { de: d0, ate: d1 } = limitesDoMes(de.slice(0, 7));
  if (de === d0 && ate === d1) return nomeDoMes(de.slice(0, 7));
  if (de.endsWith("-01-01") && ate.endsWith("-12-31") && de.slice(0, 4) === ate.slice(0, 4)) return `ano de ${de.slice(0, 4)}`;
  return `${data(`${de}T12:00:00`)} a ${data(`${ate}T12:00:00`)}`;
}

// ---------- Documentos ----------

export const soDigitos = (s: string | undefined | null) => String(s ?? "").replace(/\D/g, "");

// CNPJ e chave de acesso podem ter letras desde julho de 2026 (CNPJ alfanumérico):
// guarda só letras maiúsculas e números.
export const soDocumento = (s: string | undefined | null) => String(s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

// Valor de um caractere no cálculo dos dígitos verificadores: código ASCII − 48 (para dígitos, o próprio dígito).
const valorDV = (c: string) => c.charCodeAt(0) - 48;

export function formatarDocumento(s: string | undefined): string {
  const d = soDocumento(s);
  if (d.length === 14) return d.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11 && /^\d+$/.test(d)) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return s ?? "";
}

export function cnpjValido(s: string | undefined): boolean {
  const d = soDocumento(s);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((a, c, i) => a + valorDV(c) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d.slice(0, 12));
  const d2 = dv(d.slice(0, 12) + d1);
  return d.endsWith(`${d1}${d2}`);
}

export function cpfValido(s: string | undefined): boolean {
  const d = soDigitos(s);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (base: string) => {
    const soma = [...base].reduce((a, c, i) => a + Number(c) * (base.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(d.slice(0, 9));
  const d2 = dv(d.slice(0, 9) + d1);
  return d.endsWith(`${d1}${d2}`);
}

// Vazio é válido (campo opcional); preenchido precisa ser CPF ou CNPJ correto.
export function documentoValido(s: string | undefined): boolean {
  const d = soDocumento(s);
  return d.length === 0 || (d.length === 14 ? cnpjValido(d) : d.length === 11 ? cpfValido(d) : false);
}

// Chave de acesso da NF-e: 44 caracteres (o CNPJ do emitente dentro dela pode ter letras);
// o último é o dígito verificador (módulo 11).
export function chaveNFeValida(s: string | undefined): boolean {
  const d = soDocumento(s);
  if (!/^[0-9A-Z]{43}\d$/.test(d)) return false;
  let peso = 2;
  let soma = 0;
  for (let i = 42; i >= 0; i--) {
    soma += valorDV(d[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  const dv = r < 2 ? 0 : 11 - r;
  return Number(d[43]) === dv;
}

export const formatarChave = (s: string | undefined) => soDocumento(s).replace(/(\w{4})(?=\w)/g, "$1 ");

export function formatarNCM(s: string | undefined): string {
  const d = soDigitos(s);
  return d.length === 8 ? d.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3") : (s ?? "");
}

// Busca sem acento e sem diferença de maiúsculas.
export function normalizar(s: string | undefined | null): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function combina(busca: string, ...campos: (string | undefined | null)[]): boolean {
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  if (!termos.length) return true;
  const alvo = normalizar(campos.filter(Boolean).join(" "));
  return termos.every((t) => alvo.includes(t));
}

export function data(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dataCurta.format(d);
}

export function dataEHora(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dataHora.format(d);
}

export function haQuanto(iso: string | undefined): string {
  if (!iso) return "nunca";
  const seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return "agora há pouco";
  const min = Math.round(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return dataEHora(iso);
}

export function hostDe(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Agrupa mantendo a ordem em que os itens chegaram (a lista já vem ordenada).
export function agruparPor<T>(itens: T[], chave: (item: T) => string): [string, T[]][] {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    const k = chave(item);
    const lista = grupos.get(k);
    if (lista) lista.push(item);
    else grupos.set(k, [item]);
  }
  return [...grupos.entries()];
}

export const plural = (n: number, um: string, varios: string) => `${num(n)} ${n === 1 ? um : varios}`;

export const ROTULOS = {
  modoCobranca: { unidade: "Por unidade", modelo: "Fixo por modelo", lote: "Fixo por lote" },
  origem: { nacional: "Nacional", importado: "Importado" },
  tipoFornecedor: { nacional: "Nacional", importacao: "Importação" },
  statusLote: {
    planejado: "Planejado",
    comprando: "Comprando",
    em_producao: "Em produção",
    concluido: "Concluído",
    cancelado: "Cancelado",
  },
  statusCompra: {
    rascunho: "Rascunho",
    pedido: "Pedido feito",
    em_transito: "Em trânsito",
    recebida_parcial: "Recebida parcial",
    recebida: "Recebida",
    cancelada: "Cancelada",
  },
  documento: {
    nfe: "NF-e",
    nfce: "NFC-e",
    importacao: "Importação",
    recibo: "Recibo",
    sem_documento: "Sem documento",
  },
  compradoEm: { cnpj: "CNPJ", cpf: "CPF", nao_informado: "Não informado" },
  tipoMovimento: {
    saldo_inicial: "Saldo inicial",
    entrada_compra: "Entrada de compra",
    consumo_producao: "Consumo na produção",
    ajuste: "Ajuste",
    perda: "Perda",
    devolucao: "Devolução",
  },
  tipoCusto: {
    mao_de_obra: "Mão de obra",
    energia: "Energia",
    consumiveis: "Consumíveis",
    terceirizado: "Serviço de terceiros",
    rateio_fixo: "Rateio de custos fixos",
    outro: "Outro",
  },
  // Código de origem da mercadoria na NF-e (tabela A do ICMS).
  origemFiscal: {
    "0": "0 — Nacional",
    "1": "1 — Estrangeira, importação direta",
    "2": "2 — Estrangeira, comprada no mercado interno",
    "3": "3 — Nacional, conteúdo importado acima de 40% e até 70%",
    "4": "4 — Nacional, processo produtivo básico",
    "5": "5 — Nacional, conteúdo importado até 40%",
    "6": "6 — Estrangeira, importação direta sem similar",
    "7": "7 — Estrangeira, mercado interno sem similar",
    "8": "8 — Nacional, conteúdo importado acima de 70%",
  },
  regime: {
    "": "Não informado",
    mei: "MEI",
    me_simples: "ME — Simples Nacional",
    epp_simples: "EPP — Simples Nacional",
    presumido: "Lucro Presumido",
    outro: "Outro",
  },
} as const;
