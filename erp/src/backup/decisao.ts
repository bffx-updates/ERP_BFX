// Decide o que fazer ao comparar este computador com o arquivo da pasta sincronizada.
// Função pura: toda a regra de sincronização entre computadores está aqui e nos testes ao lado.

export type AcaoSincronizacao = "nada" | "escrever" | "carregar" | "conflito";

export interface ArquivoNaPasta {
  revisao: string; // revisão gravada no arquivo; arquivos antigos recebem uma derivada da data
  legado: boolean; // gravado antes de a sincronização existir, sem revisão própria
}

export interface SituacaoLocal {
  arquivo?: ArquivoNaPasta; // ausente = a pasta ainda não tem o arquivo
  revisaoLocal?: string; // última revisão que este computador carregou ou gravou
  pendente: boolean; // há alterações aqui que ainda não foram para a pasta
  temDados: boolean; // este computador tem dados da empresa
  pastaNova: boolean; // a pasta acabou de ser escolhida neste computador
}

export function decidirSincronizacao(s: SituacaoLocal): AcaoSincronizacao {
  // Pasta sem arquivo: grava o que houver aqui.
  if (!s.arquivo) return s.temDados || s.pendente ? "escrever" : "nada";

  // O arquivo é exatamente o que este computador conhece.
  if (s.arquivo.revisao === s.revisaoLocal) return s.pendente ? "escrever" : "nada";

  // Daqui em diante o arquivo tem uma versão que este computador ainda não viu.
  if (!s.temDados && !s.pendente) return "carregar"; // computador novo ou vazio
  if (s.pastaNova) return "conflito"; // a pasta escolhida agora já tem dados, e este computador também
  if (s.arquivo.legado && !s.revisaoLocal) return "escrever"; // arquivo antigo gravado por este mesmo computador
  return s.pendente ? "conflito" : "carregar"; // os dois mudaram, ou só o outro computador
}
