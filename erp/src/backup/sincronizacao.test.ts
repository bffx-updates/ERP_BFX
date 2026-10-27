import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db";
import type { Componente } from "../data/tipos";
import { criarPastaFalsa, type PastaFalsa } from "./pastaFalsa";
import {
  ouvirAvisos,
  prepararParaTeste,
  resolverConflito,
  resolverCopiaExtra,
  sincronizar,
  statusSincronizacao,
  substituirArquivoIlegivel,
} from "./sincronizacao";
import { apagarTudo, type Snapshot } from "./snapshot";

const AQUI = { id: "pc_escritorio", nome: "Escritório" };
const NOTEBOOK = { id: "pc_notebook", nome: "Notebook" };
const PRINCIPAL = "bffx-dados.json";

const componente = (id: string, nome: string): Componente => ({
  id,
  nome,
  categoria: "Placa",
  unidade: "un",
  estoqueMinimo: 0,
  modoCobranca: "unidade",
  controlaEstoque: true,
  ativo: true,
  criadoEm: "2026-09-01T00:00:00.000Z",
});

// Arquivo como o outro computador gravaria; sem revisão = formato antigo.
function doNotebook(revisao: string | undefined, nomes: string[], base?: string): string {
  const snapshot: Snapshot = {
    app: "bffx-erp",
    formato: 1,
    exportadoEm: "2026-09-28T14:32:00.000Z",
    ...(revisao ? { revisao, baseRevisao: base, dispositivo: NOTEBOOK } : {}),
    tabelas: { componentes: nomes.map((n) => componente(`id_${n}`, n)) },
  };
  return JSON.stringify(snapshot);
}

let pasta: PastaFalsa;
let avisos: string[];
let pararDeOuvir: () => void;

const principal = () => JSON.parse(pasta.ler(PRINCIPAL)!) as Snapshot;
const nomesNaPasta = () => (principal().tabelas.componentes as Componente[]).map((c) => c.nome).sort();
const nomesAqui = async () => (await db.componentes.toArray()).map((c) => c.nome).sort();
const alterarAqui = async (nome: string) => db.componentes.put(componente(`id_${nome}`, nome));

async function conectadoNaRevisao(nomes: string[]) {
  pasta.escrever(PRINCIPAL, doNotebook("r1", nomes));
  await sincronizar({ pastaNova: true, forcar: true });
}

beforeEach(async () => {
  await apagarTudo();
  await db.sistema.clear();
  pasta = criarPastaFalsa();
  prepararParaTeste(pasta.handle, AQUI);
  avisos = [];
  pararDeOuvir = ouvirAvisos((a) => avisos.push(a.texto));
});

afterEach(() => pararDeOuvir());

describe("sincronização pela pasta", () => {
  it("computador novo carrega o que está na pasta, sem gravar nada de volta", async () => {
    await conectadoNaRevisao(["PCB 8SW+", "Display"]);
    expect(await nomesAqui()).toEqual(["Display", "PCB 8SW+"]);
    expect(statusSincronizacao().pendente).toBe(false);
    expect(statusSincronizacao().ultimaExterna?.dispositivo).toBe("Notebook");
    expect(avisos[0]).toMatch(/carregados da pasta/);
    expect(principal().revisao).toBe("r1");
  });

  it("alteração aqui grava uma revisão nova, baseada na anterior, com o nome deste computador", async () => {
    await conectadoNaRevisao(["PCB"]);
    await alterarAqui("Chave SPST");
    expect(statusSincronizacao().pendente).toBe(true);

    await sincronizar({ forcar: true });
    const arquivo = principal();
    expect(arquivo.revisao).not.toBe("r1");
    expect(arquivo.baseRevisao).toBe("r1");
    expect(arquivo.dispositivo).toEqual(AQUI);
    expect(nomesNaPasta()).toEqual(["Chave SPST", "PCB"]);
    expect(statusSincronizacao().pendente).toBe(false);
    expect(pasta.subpasta("historico")?.nomes()).toHaveLength(1);
  });

  it("carrega sozinho o que outro computador gravou quando aqui não há alteração", async () => {
    await conectadoNaRevisao(["PCB"]);
    pasta.escrever(PRINCIPAL, doNotebook("r2", ["PCB", "Caixa Metal"], "r1"));
    await sincronizar({ forcar: true });
    expect(await nomesAqui()).toEqual(["Caixa Metal", "PCB"]);
    expect(avisos.at(-1)).toMatch(/alterações de Notebook/);
  });

  it("os dois computadores mudaram: pergunta e não sobrescreve nenhum lado", async () => {
    await conectadoNaRevisao(["PCB"]);
    await alterarAqui("Feito aqui");
    pasta.escrever(PRINCIPAL, doNotebook("r2", ["PCB", "Feito no notebook"], "r1"));

    await sincronizar({ forcar: true });
    expect(statusSincronizacao().conflito?.tipo).toBe("dois_computadores");
    expect(statusSincronizacao().conflito?.versao.dispositivo).toBe("Notebook");
    expect(principal().revisao).toBe("r2");
    expect(await nomesAqui()).toContain("Feito aqui");

    // Enquanto não houver decisão, nada é gravado.
    await sincronizar({ forcar: true });
    expect(principal().revisao).toBe("r2");
  });

  it("manter a versão deste computador grava por cima e guarda a outra em conflitos/", async () => {
    await conectadoNaRevisao(["PCB"]);
    await alterarAqui("Feito aqui");
    pasta.escrever(PRINCIPAL, doNotebook("r2", ["PCB", "Feito no notebook"], "r1"));
    await sincronizar({ forcar: true });

    await resolverConflito("local");
    expect(principal().baseRevisao).toBe("r2");
    expect(nomesNaPasta()).toEqual(["Feito aqui", "PCB"]);
    const conflitos = pasta.subpasta("conflitos")!;
    expect(conflitos.nomes()).toHaveLength(1);
    expect(conflitos.nomes()[0]).toMatch(/^bffx-dados-notebook-/);
    expect(conflitos.ler(conflitos.nomes()[0])).toContain("Feito no notebook");
    expect(statusSincronizacao().conflito).toBeUndefined();
    expect(statusSincronizacao().pendente).toBe(false);
  });

  it("usar a versão da pasta carrega a outra e guarda a deste computador em conflitos/", async () => {
    await conectadoNaRevisao(["PCB"]);
    await alterarAqui("Feito aqui");
    pasta.escrever(PRINCIPAL, doNotebook("r2", ["PCB", "Feito no notebook"], "r1"));
    await sincronizar({ forcar: true });

    await resolverConflito("pasta");
    expect(await nomesAqui()).toEqual(["Feito no notebook", "PCB"]);
    const conflitos = pasta.subpasta("conflitos")!;
    expect(conflitos.nomes()[0]).toMatch(/^bffx-dados-escritorio-/);
    expect(conflitos.ler(conflitos.nomes()[0])).toContain("Feito aqui");
    expect(statusSincronizacao().pendente).toBe(false);
  });

  it("pasta escolhida já com dados e este computador também com dados: pergunta antes", async () => {
    await alterarAqui("Daqui");
    pasta.escrever(PRINCIPAL, doNotebook("r1", ["PCB"]));
    await sincronizar({ pastaNova: true, forcar: true });
    expect(statusSincronizacao().conflito?.tipo).toBe("primeira_conexao");
    expect(principal().revisao).toBe("r1");
  });

  it("pasta vazia recebe os dados deste computador", async () => {
    await alterarAqui("Daqui");
    await sincronizar({ pastaNova: true, forcar: true });
    expect(nomesNaPasta()).toEqual(["Daqui"]);
    expect(principal().revisao).toBeTruthy();
  });

  it("arquivo antigo, sem revisão, gravado por este computador passa para o formato novo", async () => {
    await alterarAqui("Daqui");
    pasta.escrever(PRINCIPAL, doNotebook(undefined, ["Daqui"]));
    prepararParaTeste(pasta.handle, AQUI); // como ao abrir a versão nova: nada pendente, sem revisão conhecida
    await sincronizar({ forcar: true });
    expect(principal().revisao).toBeTruthy();
    expect(principal().dispositivo).toEqual(AQUI);
  });

  it("arquivo ilegível nunca é sobrescrito sozinho; substituir guarda o original", async () => {
    await alterarAqui("Daqui");
    pasta.escrever(PRINCIPAL, '{"app":"bffx-erp", incompleto');
    await sincronizar({ forcar: true });
    expect(statusSincronizacao().arquivoIlegivel).toBe(true);
    expect(pasta.ler(PRINCIPAL)).toBe('{"app":"bffx-erp", incompleto');

    await substituirArquivoIlegivel();
    expect(nomesNaPasta()).toEqual(["Daqui"]);
    expect(pasta.subpasta("conflitos")!.nomes()[0]).toMatch(/arquivo-ilegivel/);
    expect(statusSincronizacao().erro).toBeUndefined();
  });

  it("versão extra criada pelo OneDrive pausa a gravação; descartar a guarda em conflitos/", async () => {
    await conectadoNaRevisao(["PCB"]);
    pasta.escrever("bffx-dados-NOTEBOOK.json", doNotebook("r9", ["PCB", "Do notebook"], "r1"));
    await alterarAqui("Daqui");

    await sincronizar({ forcar: true });
    expect(statusSincronizacao().copia?.nome).toBe("bffx-dados-NOTEBOOK.json");
    expect(statusSincronizacao().copia?.versao?.dispositivo).toBe("Notebook");
    expect(principal().revisao).toBe("r1");

    await resolverCopiaExtra("descartar");
    expect(pasta.nomes()).not.toContain("bffx-dados-NOTEBOOK.json");
    expect(pasta.subpasta("conflitos")!.nomes()).toHaveLength(1);
    await sincronizar({ forcar: true });
    expect(nomesNaPasta()).toEqual(["Daqui", "PCB"]);
  });

  it("usar a versão extra a torna a atual e guarda a anterior em conflitos/", async () => {
    await conectadoNaRevisao(["PCB"]);
    pasta.escrever("bffx-dados-NOTEBOOK.json", doNotebook("r9", ["PCB", "Do notebook"], "r1"));
    await sincronizar({ forcar: true });

    await resolverCopiaExtra("usar");
    expect(await nomesAqui()).toEqual(["Do notebook", "PCB"]);
    expect(principal().baseRevisao).toBe("r9");
    expect(pasta.nomes()).toEqual([PRINCIPAL]);
    expect(pasta.subpasta("conflitos")!.nomes()).toHaveLength(1);
  });
});
