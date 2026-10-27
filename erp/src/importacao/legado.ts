// Converte os dados do app antigo (BFMiDi — Acompanhamento de compras) para o modelo do ERP.
// Fonte: o arquivo "bfmidi-backup.json" ou as chaves bfmidi.* do localStorage do navegador.
//
// Decisões:
// - IDs antigos de peças e modelos são mantidos, então reimportar não duplica nada.
// - Fornecedores são deduzidos pelo domínio do link de cada peça.
// - Compras antigas viram registros "legado" (histórico e custo), sem gerar movimento de estoque.
// - O estoque atual vira um "saldo inicial": sobra no inventário + o que já foi comprado ou
//   separado para o lote em andamento. Deve ser conferido na contagem física da transição MEI → ME.

import type {
  Componente,
  ComponenteFornecedor,
  Composicao,
  ComposicaoItem,
  Compra,
  CompraItem,
  ConfigItem,
  Fornecedor,
  Lote,
  LoteItem,
  ModoCobranca,
  Movimento,
  Produto,
  StatusLote,
} from "../data/tipos";

interface ParteLegada {
  name?: string;
  cat?: string;
  price?: number;
  url?: string;
  variant?: string;
  nolink?: boolean;
  chargeMode?: string;
  perModel?: boolean;
  perLot?: boolean;
}

interface ModeloLegado {
  name?: string;
  img?: string;
  salePrice?: number;
  bom?: Record<string, number>;
}

interface CompraLegada {
  id?: string;
  q?: number;
  v?: number;
  at?: string | number;
}

export interface RunLegado {
  at?: string;
  spare?: number;
  order?: Record<string, number>;
  needM?: Record<string, Record<string, number>>;
  stockUsed?: Record<string, Record<string, number>>;
  names?: Record<string, string>;
  bom?: Record<string, { name?: string; img?: string; salePrice?: number; parts?: Record<string, number> }>;
  buys?: Record<string, Record<string, CompraLegada[]>>;
}

export interface BackupLegado {
  db: { parts: Record<string, ParteLegada>; models: Record<string, ModeloLegado> };
  order?: Record<string, number>;
  opts?: { spare?: number; showPrice?: boolean };
  run?: RunLegado | null;
  inventory?: Record<string, number>;
  history?: { id?: string; closedAt?: string; status?: string; surplus?: Record<string, number>; run?: RunLegado }[];
}

export interface RegistrosImportados {
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
  config: ConfigItem[];
}

export interface ResultadoImportacao {
  registros: RegistrosImportados;
  avisos: string[];
}

// Imagens embutidas no app, referenciadas por marcador e resolvidas na hora de gravar.
export const IMAGEM_8SW = "asset:8sw";
export const IMAGEM_NANO = "asset:nano";

const IMAGENS_CONHECIDAS: Record<string, string> = {
  "8SW.png": IMAGEM_8SW,
  "8SW.svg": IMAGEM_8SW,
  "NANO.png": IMAGEM_NANO,
  "NANO.svg": IMAGEM_NANO,
};

const FORNECEDORES_CONHECIDOS: { padrao: RegExp; dados: Omit<Fornecedor, "criadoEm" | "ativo"> }[] = [
  {
    padrao: /aliexpress\./i,
    dados: { id: "forn_aliexpress", nome: "AliExpress", tipo: "importacao", pais: "China", site: "https://pt.aliexpress.com" },
  },
  {
    padrao: /mercado(livre|libre)\./i,
    dados: { id: "forn_mercadolivre", nome: "Mercado Livre", tipo: "nacional", pais: "Brasil", site: "https://www.mercadolivre.com.br" },
  },
  {
    padrao: /rpcaixas\./i,
    dados: { id: "forn_rpcaixas", nome: "RP Caixas", tipo: "nacional", pais: "Brasil", site: "https://www.rpcaixas.com.br" },
  },
];

export function ehBackupLegado(x: unknown): x is BackupLegado {
  const d = x as BackupLegado;
  return !!d && typeof d === "object" && !!d.db && typeof d.db.parts === "object" && typeof d.db.models === "object";
}

// Lê os dados do app antigo guardados neste navegador (mesma origem file://).
export function lerLegadoDoNavegador(storage: Storage = localStorage): BackupLegado | null {
  const ler = (k: string) => {
    try {
      const v = storage.getItem(k);
      return v ? JSON.parse(v) : undefined;
    } catch {
      return undefined;
    }
  };
  const dbLegado = ler("bfmidi.db.v5");
  if (!dbLegado) return null;
  const backup = {
    db: dbLegado,
    order: ler("bfmidi.order.v1"),
    opts: ler("bfmidi.opts.v1"),
    run: ler("bfmidi.run.v1") ?? null,
    inventory: ler("bfmidi.inventory.v1"),
    history: ler("bfmidi.history.v1"),
  };
  return ehBackupLegado(backup) ? backup : null;
}

function paraISO(v: unknown, padrao: string): string {
  if (typeof v === "number" || typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return padrao;
}

function modoDe(p: ParteLegada): ModoCobranca {
  if (p.chargeMode === "lot" || p.perLot) return "lote";
  if (p.chargeMode === "model" || p.perModel) return "modelo";
  return "unidade";
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function hostDe(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function converterLegado(backup: BackupLegado, agora = new Date().toISOString()): ResultadoImportacao {
  const avisos: string[] = [];
  const r: RegistrosImportados = {
    fornecedores: [],
    componentes: [],
    componenteFornecedores: [],
    produtos: [],
    composicoes: [],
    composicaoItens: [],
    movimentos: [],
    compras: [],
    compraItens: [],
    lotes: [],
    loteItens: [],
    config: [],
  };

  const fornecedores = new Map<string, Fornecedor>();
  const fornecedorDoComponente = new Map<string, string>();

  function fornecedorPorUrl(url: string | undefined): Fornecedor | undefined {
    const host = hostDe(url);
    if (!host) return undefined;
    const conhecido = FORNECEDORES_CONHECIDOS.find((f) => f.padrao.test(host));
    const dados = conhecido
      ? conhecido.dados
      : { id: `forn_${slug(host)}`, nome: host, tipo: "nacional" as const, site: `https://${host}` };
    let f = fornecedores.get(dados.id);
    if (!f) {
      f = { ...dados, ativo: true, criadoEm: agora };
      fornecedores.set(f.id, f);
    }
    return f;
  }

  // --- Componentes ---
  const componentes = new Map<string, Componente>();
  for (const [pid, p] of Object.entries(backup.db.parts)) {
    const forn = fornecedorPorUrl(p.url);
    const pseudoCusto = /frete.*dhl.*imposto/i.test(p.name ?? "");
    const c: Componente = {
      id: pid,
      nome: p.name?.trim() || pid,
      categoria: pseudoCusto ? "Custo (legado)" : p.cat?.trim() || "Sem categoria",
      variante: p.variant || undefined,
      unidade: "un",
      estoqueMinimo: 0,
      custoReferencia: Number(p.price) > 0 ? Number(p.price) : undefined,
      origem: forn?.tipo === "importacao" ? "importado" : undefined,
      modoCobranca: modoDe(p),
      controlaEstoque: !pseudoCusto,
      ativo: true,
      criadoEm: agora,
    };
    if (pseudoCusto) {
      c.obs = "No app antigo o frete/imposto era lançado como peça. Nas compras do ERP ele é distribuído entre os itens.";
      avisos.push(`"${c.nome}" era frete/imposto lançado como peça; foi importado na categoria "Custo (legado)".`);
    }
    componentes.set(pid, c);
    if (forn && p.url) {
      fornecedorDoComponente.set(pid, forn.id);
      r.componenteFornecedores.push({
        id: `cf_${pid}_${forn.id}`,
        componenteId: pid,
        fornecedorId: forn.id,
        url: p.url,
        precoRef: c.custoReferencia,
        preferido: true,
      });
    }
  }

  function garantirComponente(pid: string, nome: string | undefined) {
    if (componentes.has(pid)) return;
    componentes.set(pid, {
      id: pid,
      nome: nome || pid,
      categoria: "Sem categoria",
      unidade: "un",
      estoqueMinimo: 0,
      modoCobranca: "unidade",
      controlaEstoque: true,
      ativo: false,
      obs: "Peça que não existe mais no cadastro do app antigo, mas aparece no histórico.",
      criadoEm: agora,
    });
  }

  // --- Produtos e composição v1 ---
  const produtos = new Map<string, Produto>();
  function imagemDe(img: string | undefined): string | undefined {
    if (!img) return undefined;
    if (img.startsWith("data:")) return img;
    return IMAGENS_CONHECIDAS[img];
  }

  for (const [mid, m] of Object.entries(backup.db.models)) {
    const composicaoId = `comp_${mid}_v1`;
    const produto: Produto = {
      id: mid,
      nome: m.name?.trim() || mid,
      imagem: imagemDe(m.img),
      precoVenda: Number(m.salePrice) || 0,
      tipo: "fabricacao",
      composicaoAtualId: composicaoId,
      ativo: true,
      criadoEm: agora,
    };
    if (m.img && !produto.imagem) avisos.push(`A imagem de "${produto.nome}" não pôde ser importada; escolha outra no cadastro.`);
    produtos.set(mid, produto);
    r.composicoes.push({ id: composicaoId, produtoId: mid, versao: 1, criadaEm: agora, obs: "Importada do app antigo" });
    for (const [pid, qtd] of Object.entries(m.bom ?? {})) {
      if (!componentes.has(pid) || !(Number(qtd) > 0)) continue;
      r.composicaoItens.push({ id: `ci_${mid}_v1_${pid}`, composicaoId, componenteId: pid, quantidade: Number(qtd) });
    }
  }

  function garantirProduto(mid: string, run: RunLegado) {
    if (produtos.has(mid)) return;
    const b = run.bom?.[mid];
    produtos.set(mid, {
      id: mid,
      nome: b?.name || mid,
      imagem: imagemDe(b?.img),
      precoVenda: Number(b?.salePrice) || 0,
      tipo: "fabricacao",
      ativo: false,
      criadoEm: agora,
    });
  }

  // --- Lotes e compras ---
  const custoAcumulado = new Map<string, { q: number; v: number }>();

  function importarRun(run: RunLegado, lote: Omit<Lote, "margemSobra" | "criadoEm" | "nome" | "legado">) {
    const order = run.order ?? {};
    const pedido = Object.entries(order)
      .map(([mid, n]) => `${n}× ${run.bom?.[mid]?.name ?? backup.db.models[mid]?.name ?? mid}`)
      .join(", ");
    r.lotes.push({
      ...lote,
      nome: pedido || undefined,
      margemSobra: Number(run.spare) || 0,
      criadoEm: paraISO(run.at, lote.concluidoEm ?? agora),
      legado: run,
    });
    for (const [mid, n] of Object.entries(order)) {
      garantirProduto(mid, run);
      r.loteItens.push({
        id: `li_${lote.id}_${mid}`,
        loteId: lote.id,
        produtoId: mid,
        composicaoId: backup.db.models[mid] ? `comp_${mid}_v1` : undefined,
        qtdPlanejada: Number(n) || 0,
        qtdProduzida: null,
        qtdRefugo: 0,
      });
    }

    // Mesmo agrupamento do app antigo: uma compra registrada é dividida entre os modelos com o mesmo id.
    const grupos = new Map<string, { pid: string; at: string; q: number; v: number }>();
    for (const [mid, porPeca] of Object.entries(run.buys ?? {})) {
      for (const [pid, entradas] of Object.entries(porPeca ?? {})) {
        (entradas ?? []).forEach((e, i) => {
          const chave = e.id ? `tx:${e.id}:${pid}` : `legado:${pid}:${String(e.at ?? `${mid}:${i}`).slice(0, 19)}`;
          const g = grupos.get(chave) ?? { pid, at: paraISO(e.at ?? run.at, agora), q: 0, v: 0 };
          g.q += Number(e.q) || 0;
          g.v += Number(e.v) || 0;
          grupos.set(chave, g);
        });
      }
    }
    let n = 0;
    for (const g of [...grupos.values()].sort((a, b) => a.at.localeCompare(b.at))) {
      if (g.q <= 0) continue;
      n++;
      garantirComponente(g.pid, run.names?.[g.pid]);
      const compraId = `cp_${lote.id}_${n}`;
      r.compras.push({
        id: compraId,
        fornecedorId: fornecedorDoComponente.get(g.pid),
        data: g.at,
        status: "recebida",
        documentoTipo: "sem_documento",
        compradoEm: "nao_informado",
        frete: 0,
        impostos: 0,
        outrasDespesas: 0,
        moeda: "BRL",
        loteId: lote.id,
        legado: true,
        obs: "Importada do app antigo",
      });
      r.compraItens.push({ id: `${compraId}_1`, compraId, componenteId: g.pid, quantidade: g.q, valorTotal: g.v, qtdRecebida: g.q });
      if (g.v > 0) {
        const c = custoAcumulado.get(g.pid) ?? { q: 0, v: 0 };
        c.q += g.q;
        c.v += g.v;
        custoAcumulado.set(g.pid, c);
      }
    }
  }

  const historico = [...(backup.history ?? [])]
    .filter((h) => h && h.run)
    .sort((a, b) => paraISO(a.run?.at ?? a.closedAt, "").localeCompare(paraISO(b.run?.at ?? b.closedAt, "")));
  let seq = 0;
  for (const h of historico) {
    seq++;
    const substituido = h.status === "substituído";
    importarRun(h.run!, {
      id: h.id ? `lote_${h.id}` : `lote_legado_${seq}`,
      codigo: `L-${String(seq).padStart(3, "0")}`,
      status: "concluido" as StatusLote,
      concluidoEm: paraISO(h.closedAt, agora),
      obs: substituido ? "Encerrado automaticamente quando outro lote foi iniciado no app antigo." : "Importado do app antigo.",
    });
  }

  const runAtivo = backup.run && backup.run.order ? backup.run : null;
  if (runAtivo) {
    seq++;
    importarRun(runAtivo, {
      id: "lote_ativo_legado",
      codigo: `L-${String(seq).padStart(3, "0")}`,
      status: "comprando",
      obs: "Lote que estava em andamento no app antigo.",
    });
  }
  if (historico.length || runAtivo) {
    avisos.push("Lotes antigos não registravam quantas unidades foram produzidas; isso fica como \"não registrado\".");
  }

  // --- Saldo inicial de estoque ---
  const saldo = new Map<string, number>();
  const somar = (pid: string, q: number) => {
    if (q > 0) saldo.set(pid, (saldo.get(pid) ?? 0) + q);
  };
  for (const [pid, q] of Object.entries(backup.inventory ?? {})) somar(pid, Number(q) || 0);
  if (runAtivo) {
    for (const porPeca of Object.values(runAtivo.stockUsed ?? {})) {
      for (const [pid, q] of Object.entries(porPeca ?? {})) somar(pid, Number(q) || 0);
    }
    for (const porPeca of Object.values(runAtivo.buys ?? {})) {
      for (const [pid, entradas] of Object.entries(porPeca ?? {})) {
        somar(pid, (entradas ?? []).reduce((a, e) => a + (Number(e.q) || 0), 0));
      }
    }
  }
  for (const [pid, q] of [...saldo.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    garantirComponente(pid, runAtivo?.names?.[pid]);
    const acumulado = custoAcumulado.get(pid);
    const custo = acumulado && acumulado.q > 0 ? acumulado.v / acumulado.q : componentes.get(pid)?.custoReferencia ?? 0;
    r.movimentos.push({
      id: `mov_inicial_${pid}`,
      data: agora,
      componenteId: pid,
      tipo: "saldo_inicial",
      quantidade: q,
      custoUnitario: custo,
      refTipo: "importacao",
      obs: "Saldo importado do app antigo — confirme na contagem física.",
    });
  }
  if (saldo.size) {
    avisos.push(
      runAtivo
        ? "O saldo inicial inclui as peças já compradas ou separadas para o lote em andamento. Confira tudo na contagem física da transição para ME."
        : "Confira o saldo inicial na contagem física da transição para ME.",
    );
  }
  const semOrigem = [...componentes.values()].filter((c) => c.ativo && c.controlaEstoque && !c.origem).length;
  if (semOrigem) avisos.push(`${semOrigem} componente(s) estão sem origem fiscal (nacional/importado) definida.`);

  if (backup.opts && Number(backup.opts.spare) > 0) {
    r.config.push({ chave: "margemPadrao", valor: Number(backup.opts.spare) });
  }

  r.fornecedores = [...fornecedores.values()];
  r.componentes = [...componentes.values()];
  r.produtos = [...produtos.values()];
  return { registros: r, avisos };
}
