import { db, TABELAS_DADOS, tabela, type TabelaDados } from "../data/db";
import { plural } from "../data/formato";

export interface Snapshot {
  app: "bffx-erp";
  formato: 1;
  exportadoEm: string;
  // Controle da sincronização entre computadores (ausente em backups manuais e arquivos antigos).
  revisao?: string;
  baseRevisao?: string;
  dispositivo?: { id: string; nome: string };
  tabelas: Partial<Record<TabelaDados, unknown[]>>;
}

export type MetaSincronizacao = Pick<Snapshot, "revisao" | "baseRevisao" | "dispositivo">;

interface BlobSerializado {
  __blob: string; // data URL
}

async function blobParaDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binario)}`;
}

async function dataUrlParaBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

// JSON não guarda Blob; anexos (PDF/XML das notas) viram data URL no backup.
async function serializar(linha: Record<string, unknown>): Promise<Record<string, unknown>> {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(linha)) {
    saida[k] = v instanceof Blob ? ({ __blob: await blobParaDataUrl(v) } satisfies BlobSerializado) : v;
  }
  return saida;
}

async function desserializar(linha: Record<string, unknown>): Promise<Record<string, unknown>> {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(linha)) {
    const b = v as BlobSerializado | null;
    saida[k] = b && typeof b === "object" && typeof b.__blob === "string" ? await dataUrlParaBlob(b.__blob) : v;
  }
  return saida;
}

export async function gerarSnapshot(meta: MetaSincronizacao = {}): Promise<Snapshot> {
  const tabelas: Snapshot["tabelas"] = {};
  await db.transaction("r", TABELAS_DADOS.map(tabela), async () => {
    for (const nome of TABELAS_DADOS) tabelas[nome] = await tabela(nome).toArray();
  });
  if (tabelas.anexos?.length) {
    tabelas.anexos = await Promise.all(tabelas.anexos.map((l) => serializar(l as Record<string, unknown>)));
  }
  return { app: "bffx-erp", formato: 1, exportadoEm: new Date().toISOString(), ...meta, tabelas };
}

export function ehSnapshot(x: unknown): x is Snapshot {
  const s = x as Snapshot;
  return !!s && s.app === "bffx-erp" && s.formato === 1 && !!s.tabelas && typeof s.tabelas === "object";
}

export function resumoSnapshot(s: Snapshot): string {
  const partes: [TabelaDados, string, string][] = [
    ["componentes", "componente", "componentes"],
    ["produtos", "produto", "produtos"],
    ["fornecedores", "fornecedor", "fornecedores"],
    ["lotes", "lote", "lotes"],
    ["compras", "compra", "compras"],
  ];
  const itens = partes
    .map(([tabela, um, varios]) => [s.tabelas[tabela]?.length ?? 0, um, varios] as const)
    .filter(([n]) => n > 0)
    .map(([n, um, varios]) => plural(n, um, varios));
  return itens.length ? itens.join(", ") : "nenhum dado cadastrado";
}

export async function restaurarSnapshot(s: Snapshot): Promise<void> {
  const tabelas = { ...s.tabelas };
  if (tabelas.anexos?.length) {
    tabelas.anexos = await Promise.all(tabelas.anexos.map((l) => desserializar(l as Record<string, unknown>)));
  }
  await db.transaction("rw", TABELAS_DADOS.map(tabela), async () => {
    for (const nome of TABELAS_DADOS) {
      await tabela(nome).clear();
      const linhas = tabelas[nome];
      if (linhas?.length) await tabela(nome).bulkPut(linhas);
    }
  });
}

export async function apagarTudo(): Promise<void> {
  await db.transaction("rw", TABELAS_DADOS.map(tabela), async () => {
    for (const nome of TABELAS_DADOS) await tabela(nome).clear();
  });
}

export function baixarArquivo(nome: string, conteudo: string, tipo = "application/json") {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
