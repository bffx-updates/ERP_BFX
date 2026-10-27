// Pasta em memória que imita a File System Access API, para testar a sincronização sem o navegador.
// Usada só pelos testes.

interface Registro {
  conteudo: string;
  modificado: number;
}

let relogio = 1_000_000;

export interface PastaFalsa {
  handle: FileSystemDirectoryHandle;
  ler(nome: string): string | undefined;
  escrever(nome: string, conteudo: string): void;
  subpasta(nome: string): PastaFalsa | undefined;
  nomes(): string[];
}

export function criarPastaFalsa(nome = "OneDrive"): PastaFalsa {
  const arquivos = new Map<string, Registro>();
  const pastas = new Map<string, PastaFalsa>();
  const naoEncontrado = () => new DOMException(`Não encontrado`, "NotFoundError");

  const arquivoHandle = (n: string) => ({
    kind: "file" as const,
    name: n,
    async getFile() {
      const r = arquivos.get(n);
      if (!r) throw naoEncontrado();
      return new File([r.conteudo], n, { lastModified: r.modificado });
    },
    async createWritable() {
      let buffer = "";
      return {
        async write(dado: string) {
          buffer += dado;
        },
        async close() {
          arquivos.set(n, { conteudo: buffer, modificado: ++relogio });
        },
      };
    },
  });

  const handle = {
    kind: "directory" as const,
    name: nome,
    async getFileHandle(n: string, opcoes?: { create?: boolean }) {
      if (!arquivos.has(n)) {
        if (!opcoes?.create) throw naoEncontrado();
        arquivos.set(n, { conteudo: "", modificado: ++relogio });
      }
      return arquivoHandle(n);
    },
    async getDirectoryHandle(n: string, opcoes?: { create?: boolean }) {
      if (!pastas.has(n)) {
        if (!opcoes?.create) throw naoEncontrado();
        pastas.set(n, criarPastaFalsa(n));
      }
      return pastas.get(n)!.handle;
    },
    async removeEntry(n: string) {
      if (!arquivos.delete(n) && !pastas.delete(n)) throw naoEncontrado();
    },
    async *entries() {
      for (const n of [...arquivos.keys()]) yield [n, arquivoHandle(n)];
      for (const [n, p] of [...pastas.entries()]) yield [n, p.handle];
    },
    async queryPermission() {
      return "granted";
    },
    async requestPermission() {
      return "granted";
    },
  };

  return {
    handle: handle as unknown as FileSystemDirectoryHandle,
    ler: (n) => arquivos.get(n)?.conteudo,
    escrever: (n, conteudo) => void arquivos.set(n, { conteudo, modificado: ++relogio }),
    subpasta: (n) => pastas.get(n),
    nomes: () => [...arquivos.keys()],
  };
}
