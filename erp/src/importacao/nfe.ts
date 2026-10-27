// Leitura do XML da NF-e (modelo 55) para preencher uma compra.
// Um leitor de XML pequeno e próprio, para funcionar igual no navegador e nos testes.

export interface NoXml {
  nome: string; // sem prefixo de namespace
  atributos: Record<string, string>;
  filhos: NoXml[];
  texto: string;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (inteiro, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTIDADES[e] ?? inteiro;
  });
}

const semPrefixo = (nome: string) => nome.slice(nome.indexOf(":") + 1);

export function lerXml(xml: string): NoXml {
  const raiz: NoXml = { nome: "#documento", atributos: {}, filhos: [], texto: "" };
  const pilha: NoXml[] = [raiz];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) pilha[pilha.length - 1].texto += decodificar(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const fim = xml.indexOf("-->", lt + 4);
      i = fim < 0 ? n : fim + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const fim = xml.indexOf("]]>", lt + 9);
      pilha[pilha.length - 1].texto += xml.slice(lt + 9, fim < 0 ? n : fim);
      i = fim < 0 ? n : fim + 3;
      continue;
    }
    if (xml[lt + 1] === "?" || xml[lt + 1] === "!") {
      const fim = xml.indexOf(">", lt);
      i = fim < 0 ? n : fim + 1;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt < 0) throw new Error("XML incompleto.");
    const corpo = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (corpo[0] === "/") {
      const nome = semPrefixo(corpo.slice(1).trim());
      while (pilha.length > 1) {
        const topo = pilha.pop()!;
        if (topo.nome === nome) break;
      }
      continue;
    }
    const autoFechada = corpo.endsWith("/");
    const conteudo = autoFechada ? corpo.slice(0, -1) : corpo;
    const m = /^\s*([^\s/>]+)/.exec(conteudo);
    if (!m) continue;
    const no: NoXml = { nome: semPrefixo(m[1]), atributos: {}, filhos: [], texto: "" };
    const reAttr = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    const resto = conteudo.slice(m[0].length);
    while ((a = reAttr.exec(resto))) no.atributos[semPrefixo(a[1])] = decodificar(a[3] ?? a[4] ?? "");
    pilha[pilha.length - 1].filhos.push(no);
    if (!autoFechada) pilha.push(no);
  }
  return raiz;
}

// Primeiro descendente com o nome (busca em profundidade).
export function achar(no: NoXml | undefined, nome: string): NoXml | undefined {
  if (!no) return undefined;
  for (const f of no.filhos) {
    if (f.nome === nome) return f;
    const r = achar(f, nome);
    if (r) return r;
  }
  return undefined;
}

const filho = (no: NoXml | undefined, nome: string) => no?.filhos.find((f) => f.nome === nome);
const texto = (no: NoXml | undefined, nome: string) => filho(no, nome)?.texto.trim() ?? "";
const numero = (no: NoXml | undefined, nome: string) => {
  const v = Number(texto(no, nome));
  return Number.isFinite(v) ? v : 0;
};

export interface ItemNota {
  numero: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorProdutos: number;
  desconto: number;
  valorLiquido: number; // produtos − desconto
}

export interface NotaImportada {
  chave: string;
  numero: string;
  serie: string;
  emissao: string; // ISO
  emitente: { documento: string; nome: string; fantasia: string; uf: string; municipio: string };
  destinatario: { documento: string; nome: string };
  itens: ItemNota[];
  totais: { produtos: number; desconto: number; frete: number; seguro: number; outras: number; ipi: number; icmsSt: number; ii: number; nota: number };
}

export function lerNFe(xml: string): NotaImportada {
  const doc = lerXml(xml);
  const inf = achar(doc, "infNFe");
  if (!inf) throw new Error("Este arquivo não é o XML de uma NF-e.");
  const ide = filho(inf, "ide");
  const emit = filho(inf, "emit");
  const dest = filho(inf, "dest");
  const ender = filho(emit, "enderEmit");
  const tot = filho(filho(inf, "total"), "ICMSTot");
  const chaveProt = texto(achar(doc, "infProt"), "chNFe");
  // A chave pode ter letras (CNPJ alfanumérico); o atributo Id vem com o prefixo "NFe".
  const chave = (chaveProt || (inf.atributos.Id ?? "").replace(/^NFe/i, "")).toUpperCase().replace(/[^0-9A-Z]/g, "");
  const itens: ItemNota[] = inf.filhos
    .filter((f) => f.nome === "det")
    .map((det, idx) => {
      const prod = filho(det, "prod");
      const valorProdutos = numero(prod, "vProd");
      const desconto = numero(prod, "vDesc");
      return {
        numero: Number(det.atributos.nItem) || idx + 1,
        codigo: texto(prod, "cProd"),
        descricao: texto(prod, "xProd"),
        ncm: texto(prod, "NCM"),
        cfop: texto(prod, "CFOP"),
        unidade: texto(prod, "uCom"),
        quantidade: numero(prod, "qCom"),
        valorUnitario: numero(prod, "vUnCom"),
        valorProdutos,
        desconto,
        valorLiquido: Math.round((valorProdutos - desconto) * 100) / 100,
      };
    });
  const emissao = texto(ide, "dhEmi") || texto(ide, "dEmi");
  const d = new Date(emissao.length === 10 ? `${emissao}T12:00:00` : emissao);
  return {
    chave: chave.length === 44 ? chave : "",
    numero: texto(ide, "nNF"),
    serie: texto(ide, "serie"),
    emissao: Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
    emitente: {
      documento: (texto(emit, "CNPJ") || texto(emit, "CPF")).toUpperCase(),
      nome: texto(emit, "xNome"),
      fantasia: texto(emit, "xFant"),
      uf: texto(ender, "UF"),
      municipio: texto(ender, "xMun"),
    },
    destinatario: { documento: (texto(dest, "CNPJ") || texto(dest, "CPF")).toUpperCase(), nome: texto(dest, "xNome") },
    itens,
    totais: {
      produtos: numero(tot, "vProd"),
      desconto: numero(tot, "vDesc"),
      frete: numero(tot, "vFrete"),
      seguro: numero(tot, "vSeg"),
      outras: numero(tot, "vOutro"),
      ipi: numero(tot, "vIPI"),
      icmsSt: numero(tot, "vST"),
      ii: numero(tot, "vII"),
      nota: numero(tot, "vNF"),
    },
  };
}
