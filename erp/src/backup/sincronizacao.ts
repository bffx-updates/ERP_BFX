// Sincronização entre computadores por uma pasta compartilhada (OneDrive, Google Drive…),
// usando a File System Access API do Chrome/Edge. Pensada para um computador de cada vez.
//
// Na pasta:
//   bffx-dados.json                        → versão atual dos dados, lida e gravada por todos os computadores
//   historico/bffx-dados-AAAA-MM-DD.json   → uma cópia por dia, guardando as últimas 30
//   conflitos/…                            → versões descartadas ao resolver um conflito (nada se perde)
//
// Cada gravação leva uma revisão nova, a revisão em que se baseou e o computador que gravou.
// A regra de quando gravar, carregar ou perguntar está em decisao.ts.
import Dexie from "dexie";
import { useSyncExternalStore } from "react";
import { contarDadosDaEmpresa, lerSistema, salvarSistema, TABELAS_DADOS, tabela, uid } from "../data/db";
import { dataEHora } from "../data/formato";
import { decidirSincronizacao } from "./decisao";
import { ehSnapshot, gerarSnapshot, restaurarSnapshot, resumoSnapshot, type Snapshot } from "./snapshot";

export type EstadoPasta = "sem_suporte" | "nao_configurada" | "precisa_permissao" | "ativa";

export interface Dispositivo {
  id: string;
  nome: string;
}

export interface VersaoNaPasta {
  dispositivo: string; // nome do computador que gravou
  exportadoEm: string;
  resumo: string;
}

export interface Conflito {
  tipo: "primeira_conexao" | "dois_computadores";
  versao: VersaoNaPasta;
}

// Arquivo extra que o serviço de nuvem cria quando dois computadores gravam ao mesmo tempo.
export interface CopiaExtra {
  nome: string;
  versao?: VersaoNaPasta; // ausente se o arquivo não pôde ser lido
}

export interface StatusSincronizacao {
  pasta: EstadoPasta;
  nomePasta?: string;
  dispositivo?: Dispositivo;
  ultimo?: string; // última vez que este computador e a pasta ficaram iguais
  ocupado: boolean; // gravando ou carregando
  pendente: boolean; // alterações daqui ainda não gravadas na pasta
  erro?: string;
  arquivoIlegivel?: boolean; // o erro é o bffx-dados.json da pasta, que não pôde ser lido
  conflito?: Conflito;
  copia?: CopiaExtra;
  ultimaExterna?: { dispositivo: string; em: string }; // última alteração trazida de outro computador
}

const ARQUIVO = "bffx-dados.json";
const PASTA_HISTORICO = "historico";
const PASTA_CONFLITOS = "conflitos";
const DIAS_DE_HISTORICO = 30;
const ESPERA_MS = 2000; // pausa depois da última alteração antes de gravar
const INTERVALO_MS = 30000; // com o app aberto, procura alterações de outros computadores

// ---------- Estado observável ----------

let status: StatusSincronizacao = { pasta: "nao_configurada", ocupado: false, pendente: false };
const ouvintes = new Set<() => void>();

function atualizar(parcial: Partial<StatusSincronizacao>) {
  const mudou = Object.entries(parcial).some(([chave, valor]) => status[chave as keyof StatusSincronizacao] !== valor);
  if (!mudou) return; // a verificação periódica não redesenha a tela à toa
  status = { ...status, ...parcial };
  ouvintes.forEach((f) => f());
}

export function useStatusSincronizacao(): StatusSincronizacao {
  return useSyncExternalStore(
    (f) => {
      ouvintes.add(f);
      return () => ouvintes.delete(f);
    },
    () => status,
  );
}

export function statusSincronizacao(): StatusSincronizacao {
  return status;
}

// Mensagens para a interface; guardadas até alguém ouvir (o app pode sincronizar antes de desenhar a tela).
export interface AvisoSincronizacao {
  texto: string;
  erro?: boolean;
}
const ouvintesDeAviso = new Set<(a: AvisoSincronizacao) => void>();
const avisosGuardados: AvisoSincronizacao[] = [];

function avisar(aviso: AvisoSincronizacao) {
  if (ouvintesDeAviso.size) ouvintesDeAviso.forEach((f) => f(aviso));
  else avisosGuardados.push(aviso);
}

export function ouvirAvisos(ouvinte: (a: AvisoSincronizacao) => void): () => void {
  ouvintesDeAviso.add(ouvinte);
  avisosGuardados.splice(0).forEach(ouvinte);
  return () => {
    ouvintesDeAviso.delete(ouvinte);
  };
}

// ---------- Estado interno ----------

export const suportaPasta = typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

let pastaDeTeste: FileSystemDirectoryHandle | undefined;
const lerPasta = async () => pastaDeTeste ?? (await lerSistema<FileSystemDirectoryHandle>("pastaBackup"));

let revisaoLocal: string | undefined;
let geracao = 0; // cresce a cada alteração local; detecta alterações feitas durante uma gravação
let aplicandoPasta = false; // dados da pasta sendo gravados aqui não contam como alteração local
let agendamentoAutomatico = true;
let timer: ReturnType<typeof setTimeout> | undefined;
let ultimaVerificacao = 0;
let emCache: { modificado: number; tamanho: number; snapshot: Snapshot } | undefined;

const revisaoDe = (s: Snapshot) => s.revisao ?? `legado:${s.exportadoEm}`;
const nomeDe = (s: Snapshot) => s.dispositivo?.nome ?? "outro computador";
const versaoDe = (s: Snapshot): VersaoNaPasta => ({ dispositivo: nomeDe(s), exportadoEm: s.exportadoEm, resumo: resumoSnapshot(s) });

// Uma operação por vez: leituras e gravações na pasta nunca se sobrepõem.
let fila: Promise<unknown> = Promise.resolve();
function emFila<T>(tarefa: () => Promise<T>): Promise<T> {
  const resultado = fila.then(tarefa, tarefa);
  fila = resultado.catch(() => undefined);
  return resultado;
}

function marcarPendente(valor: boolean) {
  if (status.pendente === valor) return;
  atualizar({ pendente: valor });
  // Fora da transação que alterou os dados: gravar em "sistema" ali dentro abortaria a transação.
  setTimeout(() => void Dexie.ignoreTransaction(() => salvarSistema("backupPendente", valor)), 0);
}

async function definirRevisaoLocal(revisao: string) {
  revisaoLocal = revisao;
  await salvarSistema("revisaoLocal", revisao);
}

async function marcarSincronizado() {
  const agora = new Date().toISOString();
  await salvarSistema("ultimoBackup", agora);
  atualizar({ ultimo: agora });
}

function tratarErro(e: unknown) {
  const erro = e as DOMException;
  if (erro?.name === "NotAllowedError" || erro?.name === "SecurityError") atualizar({ pasta: "precisa_permissao" });
  else atualizar({ erro: erro?.message || String(e) });
}

// ---------- Alterações locais ----------

// Chamado a cada alteração nos dados. Operações que usam clear() (restaurar, apagar) chamam direto.
export function agendarSincronizacao(): void {
  if (aplicandoPasta) return;
  geracao++;
  marcarPendente(true);
  if (!agendamentoAutomatico || status.pasta !== "ativa") return;
  clearTimeout(timer);
  timer = setTimeout(() => void Dexie.ignoreTransaction(() => sincronizar()), ESPERA_MS);
}

let ganchosRegistrados = false;
export function registrarGanchos(): void {
  if (ganchosRegistrados) return;
  ganchosRegistrados = true;
  for (const nome of TABELAS_DADOS) {
    const t = tabela(nome);
    t.hook("creating", () => {
      agendarSincronizacao();
    });
    t.hook("updating", () => {
      agendarSincronizacao();
    });
    t.hook("deleting", () => {
      agendarSincronizacao();
    });
  }
}

// ---------- Arquivos na pasta ----------

async function escreverArquivo(pasta: FileSystemDirectoryHandle, nome: string, conteudo: string) {
  const arquivo = await pasta.getFileHandle(nome, { create: true });
  const escrita = await arquivo.createWritable();
  await escrita.write(conteudo);
  await escrita.close();
}

async function limparHistorico(pasta: FileSystemDirectoryHandle) {
  const nomes: string[] = [];
  for await (const [nome, h] of pasta.entries()) {
    if (h.kind === "file" && /^bffx-dados-\d{4}-\d{2}-\d{2}\.json$/.test(nome)) nomes.push(nome);
  }
  nomes.sort().reverse();
  for (const nome of nomes.slice(DIAS_DE_HISTORICO)) await pasta.removeEntry(nome);
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");
const hojeLocal = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso local
function carimbo() {
  const d = new Date();
  return `${hojeLocal()}_${doisDigitos(d.getHours())}-${doisDigitos(d.getMinutes())}-${doisDigitos(d.getSeconds())}`;
}
function paraNomeDeArquivo(texto: string) {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "computador"
  );
}

async function guardarEmConflitos(pasta: FileSystemDirectoryHandle, conteudo: string, origem: string) {
  const conflitos = await pasta.getDirectoryHandle(PASTA_CONFLITOS, { create: true });
  await escreverArquivo(conflitos, `bffx-dados-${paraNomeDeArquivo(origem)}-${carimbo()}.json`, conteudo);
}

interface Leitura {
  existe: boolean;
  snapshot?: Snapshot;
  erro?: string;
}

async function lerArquivoPrincipal(pasta: FileSystemDirectoryHandle): Promise<Leitura> {
  let handle: FileSystemFileHandle;
  try {
    handle = await pasta.getFileHandle(ARQUIVO);
  } catch (e) {
    if ((e as DOMException).name === "NotFoundError") return { existe: false };
    throw e;
  }
  const arquivo = await handle.getFile();
  if (emCache && emCache.modificado === arquivo.lastModified && emCache.tamanho === arquivo.size) {
    return { existe: true, snapshot: emCache.snapshot };
  }
  let json: unknown;
  try {
    json = JSON.parse(await arquivo.text());
  } catch {
    return {
      existe: true,
      erro: "O arquivo bffx-dados.json da pasta está incompleto. Se o OneDrive ainda estiver sincronizando, espere um pouco: o app tenta de novo sozinho.",
    };
  }
  if (!ehSnapshot(json)) return { existe: true, erro: "O arquivo bffx-dados.json da pasta não é um backup do BFX Technologies ERP." };
  emCache = { modificado: arquivo.lastModified, tamanho: arquivo.size, snapshot: json };
  return { existe: true, snapshot: json };
}

// O OneDrive cria "bffx-dados-NOMEDOPC.json" (e o Google Drive "bffx-dados (1).json") quando
// dois computadores gravam antes de a nuvem terminar de sincronizar.
async function procurarCopiaExtra(pasta: FileSystemDirectoryHandle): Promise<CopiaExtra | undefined> {
  for await (const [nome, h] of pasta.entries()) {
    if (h.kind !== "file" || nome === ARQUIVO || !/^bffx-dados.*\.json$/i.test(nome)) continue;
    let versao: VersaoNaPasta | undefined;
    try {
      const json = JSON.parse(await (await (h as FileSystemFileHandle).getFile()).text());
      if (ehSnapshot(json)) versao = versaoDe(json);
    } catch {
      // ilegível: mostra só o nome
    }
    return { nome, versao };
  }
  return undefined;
}

async function gravarNaPasta(pasta: FileSystemDirectoryHandle, base: string | undefined) {
  const geracaoInicial = geracao;
  const snapshot = await gerarSnapshot({ revisao: uid("rev"), baseRevisao: base, dispositivo: status.dispositivo });
  const conteudo = JSON.stringify(snapshot, null, 1);
  await escreverArquivo(pasta, ARQUIVO, conteudo);
  const historico = await pasta.getDirectoryHandle(PASTA_HISTORICO, { create: true });
  await escreverArquivo(historico, `bffx-dados-${hojeLocal()}.json`, conteudo);
  await limparHistorico(historico);
  const gravado = await (await pasta.getFileHandle(ARQUIVO)).getFile();
  emCache = { modificado: gravado.lastModified, tamanho: gravado.size, snapshot };
  await definirRevisaoLocal(snapshot.revisao!);
  await marcarSincronizado();
  // Se algo mudou enquanto gravava, continua pendente e a próxima rodada grava de novo.
  if (geracao === geracaoInicial) marcarPendente(false);
}

async function carregarDaPasta(snapshot: Snapshot) {
  aplicandoPasta = true;
  try {
    await restaurarSnapshot(snapshot);
  } finally {
    aplicandoPasta = false;
  }
  await definirRevisaoLocal(revisaoDe(snapshot));
  await marcarSincronizado();
  marcarPendente(false);
  atualizar({ ultimaExterna: { dispositivo: nomeDe(snapshot), em: snapshot.exportadoEm } });
}

// ---------- Rodada de sincronização ----------

// anunciar: o usuário pediu a sincronização e quer saber o resultado, mesmo quando nada muda.
export function sincronizar(opcoes: { pastaNova?: boolean; forcar?: boolean; anunciar?: boolean } = {}): Promise<void> {
  return emFila(async () => {
    // Foco e visibilidade disparam juntos; sem alteração local, uma verificação a cada poucos segundos basta.
    if (!opcoes.forcar && !status.pendente && Date.now() - ultimaVerificacao < 2500) return;
    ultimaVerificacao = Date.now();
    if (status.pasta !== "ativa" || status.conflito) return;
    const pasta = await lerPasta();
    if (!pasta) return;

    try {
      const leitura = await lerArquivoPrincipal(pasta);
      if (leitura.erro) {
        atualizar({ erro: leitura.erro, arquivoIlegivel: true }); // nunca grava por cima de um arquivo que não conseguiu ler
        return;
      }
      const copia = await procurarCopiaExtra(pasta);
      atualizar({ erro: undefined, arquivoIlegivel: false, copia });
      if (copia) return; // espera a decisão sobre a versão extra

      const geracaoInicial = geracao;
      const temDados = (await contarDadosDaEmpresa()) > 0;
      const s = leitura.snapshot;
      const acao = decidirSincronizacao({
        arquivo: s ? { revisao: revisaoDe(s), legado: !s.revisao } : undefined,
        revisaoLocal,
        pendente: status.pendente,
        temDados,
        pastaNova: !!opcoes.pastaNova,
      });

      if (acao === "nada") {
        if (opcoes.pastaNova) avisar({ texto: "Pasta conectada. Os dados já estavam iguais." });
        else if (opcoes.anunciar) avisar({ texto: "Tudo certo: a pasta e este computador já estavam iguais." });
        return;
      }
      if (acao === "conflito") {
        atualizar({ conflito: { tipo: opcoes.pastaNova ? "primeira_conexao" : "dois_computadores", versao: versaoDe(s!) } });
        return;
      }

      atualizar({ ocupado: true });
      if (acao === "escrever") {
        await gravarNaPasta(pasta, s ? revisaoDe(s) : revisaoLocal);
        if (opcoes.pastaNova) avisar({ texto: "Pasta conectada. Os dados deste computador foram gravados nela." });
        else if (opcoes.anunciar) avisar({ texto: "Alterações deste computador gravadas na pasta." });
      } else {
        // Uma alteração local no meio do caminho muda a decisão: fica para a próxima rodada.
        if (geracao !== geracaoInicial) return;
        await carregarDaPasta(s!);
        avisar({
          texto: temDados
            ? `Dados atualizados com as alterações de ${nomeDe(s!)} (${dataEHora(s!.exportadoEm)}).`
            : `Dados carregados da pasta: salvos por ${nomeDe(s!)} em ${dataEHora(s!.exportadoEm)}.`,
        });
      }
    } catch (e) {
      tratarErro(e);
    } finally {
      atualizar({ ocupado: false });
    }
  });
}

// ---------- Decisões do usuário ----------

// Conflito: "pasta" usa a versão que está na pasta; "local" grava a deste computador por cima.
// A versão descartada vai para conflitos/.
export function resolverConflito(escolha: "pasta" | "local"): Promise<void> {
  return emFila(async () => {
    const pasta = await lerPasta();
    if (!pasta || !status.conflito) return;
    atualizar({ ocupado: true });
    try {
      emCache = undefined; // relê do disco: pode ter mudado desde a pergunta
      const leitura = await lerArquivoPrincipal(pasta);
      if (!leitura.snapshot) throw new Error(leitura.erro ?? "O arquivo bffx-dados.json não está mais na pasta.");
      const daPasta = leitura.snapshot;
      if (escolha === "pasta") {
        const daqui = await gerarSnapshot({ dispositivo: status.dispositivo });
        await guardarEmConflitos(pasta, JSON.stringify(daqui, null, 1), status.dispositivo?.nome ?? "este computador");
        await carregarDaPasta(daPasta);
        avisar({ texto: `Versão de ${nomeDe(daPasta)} carregada. A deste computador ficou guardada em conflitos/.` });
      } else {
        await guardarEmConflitos(pasta, JSON.stringify(daPasta, null, 1), nomeDe(daPasta));
        await gravarNaPasta(pasta, revisaoDe(daPasta));
        avisar({ texto: "Versão deste computador gravada na pasta. A outra ficou guardada em conflitos/." });
      }
      atualizar({ conflito: undefined });
    } catch (e) {
      tratarErro(e);
    } finally {
      atualizar({ ocupado: false });
      depoisDeResolver();
    }
  });
}

// Versão extra criada pelo OneDrive: "usar" a torna a versão atual; "descartar" a guarda em conflitos/.
export function resolverCopiaExtra(escolha: "usar" | "descartar"): Promise<void> {
  return emFila(async () => {
    const pasta = await lerPasta();
    const copia = status.copia;
    if (!pasta || !copia) return;
    atualizar({ ocupado: true });
    try {
      const handle = await pasta.getFileHandle(copia.nome);
      const texto = await (await handle.getFile()).text();
      if (escolha === "usar") {
        let json: unknown;
        try {
          json = JSON.parse(texto);
        } catch {
          json = undefined;
        }
        if (!ehSnapshot(json)) throw new Error("Essa versão não pode ser lida. Descarte-a.");
        emCache = undefined;
        const atual = await lerArquivoPrincipal(pasta);
        if (atual.snapshot) await guardarEmConflitos(pasta, JSON.stringify(atual.snapshot, null, 1), nomeDe(atual.snapshot));
        if (status.pendente) {
          const daqui = await gerarSnapshot({ dispositivo: status.dispositivo });
          await guardarEmConflitos(pasta, JSON.stringify(daqui, null, 1), status.dispositivo?.nome ?? "este computador");
        }
        await carregarDaPasta(json);
        await gravarNaPasta(pasta, revisaoDe(json));
        avisar({ texto: "Versão extra carregada e gravada como a atual. A anterior ficou guardada em conflitos/." });
      } else {
        const origem = copia.nome.replace(/\.json$/i, "").replace(/^bffx-dados[-_ ]*/i, "");
        await guardarEmConflitos(pasta, texto, `copia-${origem || "extra"}`);
        avisar({ texto: "Versão extra guardada em conflitos/." });
      }
      await pasta.removeEntry(copia.nome);
      atualizar({ copia: undefined });
    } catch (e) {
      tratarErro(e);
    } finally {
      atualizar({ ocupado: false });
      depoisDeResolver();
    }
  });
}

// Arquivo principal ilegível de vez: guarda o conteúdo bruto em conflitos/ e grava a versão deste computador.
export function substituirArquivoIlegivel(): Promise<void> {
  return emFila(async () => {
    const pasta = await lerPasta();
    if (!pasta || !status.arquivoIlegivel) return;
    atualizar({ ocupado: true });
    try {
      const bruto = await (await (await pasta.getFileHandle(ARQUIVO)).getFile()).text();
      await guardarEmConflitos(pasta, bruto, "arquivo-ilegivel");
      emCache = undefined;
      await gravarNaPasta(pasta, revisaoLocal);
      atualizar({ erro: undefined, arquivoIlegivel: false });
      avisar({ texto: "Versão deste computador gravada na pasta. O arquivo ilegível ficou guardado em conflitos/." });
    } catch (e) {
      tratarErro(e);
    } finally {
      atualizar({ ocupado: false });
    }
  });
}

// Depois de uma decisão do usuário, grava o que estiver pendente sem esperar a próxima rodada.
function depoisDeResolver() {
  if (agendamentoAutomatico) setTimeout(() => void sincronizar({ forcar: true }), 0);
}

// ---------- Pasta, permissão e identificação do computador ----------

async function obterDispositivo(): Promise<Dispositivo> {
  const salvo = await lerSistema<Dispositivo>("dispositivo");
  if (salvo?.id) return salvo;
  const id = uid("pc");
  const novo = { id, nome: `Computador ${id.slice(-4).toUpperCase()}` };
  await salvarSistema("dispositivo", novo);
  return novo;
}

export async function renomearDispositivo(nome: string): Promise<void> {
  const atual = status.dispositivo ?? (await obterDispositivo());
  const novo = { ...atual, nome: nome.trim() || atual.nome };
  await salvarSistema("dispositivo", novo);
  atualizar({ dispositivo: novo });
}

async function verificarPermissao() {
  if (!suportaPasta && !pastaDeTeste) return atualizar({ pasta: "sem_suporte" });
  const pasta = await lerPasta();
  if (!pasta) return atualizar({ pasta: "nao_configurada", nomePasta: undefined });
  const permissao = await pasta.queryPermission({ mode: "readwrite" });
  atualizar({ pasta: permissao === "granted" ? "ativa" : "precisa_permissao", nomePasta: pasta.name });
}

export async function escolherPastaSincronizada(): Promise<boolean> {
  if (!window.showDirectoryPicker) return false;
  let pasta: FileSystemDirectoryHandle;
  try {
    pasta = await window.showDirectoryPicker({ id: "bffx-backup", mode: "readwrite", startIn: "documents" });
  } catch {
    return false; // usuário cancelou
  }
  await salvarSistema("pastaBackup", pasta);
  emCache = undefined;
  atualizar({ pasta: "ativa", nomePasta: pasta.name, conflito: undefined, copia: undefined, erro: undefined });
  await sincronizar({ pastaNova: true, forcar: true });
  return true;
}

// O navegador pede confirmação de novo quando o app é reaberto; precisa de um clique do usuário.
export async function reativarPasta(): Promise<boolean> {
  const pasta = await lerPasta();
  if (!pasta) return false;
  const permissao = await pasta.requestPermission({ mode: "readwrite" });
  if (permissao !== "granted") return false;
  atualizar({ pasta: "ativa", nomePasta: pasta.name });
  await sincronizar({ forcar: true });
  return true;
}

export async function sincronizarAgora(): Promise<boolean> {
  await sincronizar({ forcar: true, anunciar: true });
  return status.pasta === "ativa" && !status.erro && !status.conflito && !status.copia;
}

let iniciado = false;
export async function iniciarSincronizacao(): Promise<void> {
  if (iniciado) return;
  iniciado = true;
  registrarGanchos();
  const [ultimo, pendente, revisao, dispositivo] = await Promise.all([
    lerSistema<string>("ultimoBackup"),
    lerSistema<boolean>("backupPendente"),
    lerSistema<string>("revisaoLocal"),
    obterDispositivo(),
  ]);
  revisaoLocal = revisao;
  atualizar({ ultimo, pendente: !!pendente, dispositivo });

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", (e) => {
      if (status.pasta === "ativa" && (status.pendente || status.ocupado)) e.preventDefault();
    });
    // Ao voltar para o app, e de tempos em tempos, busca o que outro computador gravou.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void sincronizar();
    };
    window.addEventListener("focus", aoVoltar);
    document.addEventListener("visibilitychange", aoVoltar);
    window.setInterval(aoVoltar, INTERVALO_MS);
  }

  await verificarPermissao();
  if (status.pasta === "ativa") await sincronizar({ forcar: true });
}

// ---------- Só para testes ----------

export function prepararParaTeste(pasta: FileSystemDirectoryHandle, dispositivo: Dispositivo): void {
  pastaDeTeste = pasta;
  agendamentoAutomatico = false;
  clearTimeout(timer);
  revisaoLocal = undefined;
  geracao = 0;
  ultimaVerificacao = 0;
  emCache = undefined;
  avisosGuardados.length = 0;
  status = { pasta: "ativa", nomePasta: pasta.name, dispositivo, ocupado: false, pendente: false };
  registrarGanchos();
}
