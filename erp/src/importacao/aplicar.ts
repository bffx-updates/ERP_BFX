import img8sw from "../assets/produtos/8sw.png";
import imgNano from "../assets/produtos/nano.png";
import { contarDadosDaEmpresa, db, TABELAS_DADOS, tabela } from "../data/db";
import { IMAGEM_8SW, IMAGEM_NANO, type RegistrosImportados } from "./legado";

const ASSETS: Record<string, string> = { [IMAGEM_8SW]: img8sw, [IMAGEM_NANO]: imgNano };

// Converte a imagem embutida em data URL para que ela fique guardada no banco
// (e no backup) independente de onde o app estiver aberto.
async function paraDataUrl(url: string): Promise<string | undefined> {
  if (url.startsWith("data:")) return url;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((ok, erro) => {
      const leitor = new FileReader();
      leitor.onload = () => ok(String(leitor.result));
      leitor.onerror = () => erro(leitor.error);
      leitor.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export async function temDados(): Promise<boolean> {
  return (await contarDadosDaEmpresa()) > 0;
}

// Substitui todos os dados da empresa pelos importados. Configurações que o app antigo
// não tinha (ex.: dados da empresa) são preservadas.
export async function aplicarImportacao(registros: RegistrosImportados): Promise<void> {
  for (const p of registros.produtos) {
    if (p.imagem && ASSETS[p.imagem]) p.imagem = await paraDataUrl(ASSETS[p.imagem]);
  }
  await db.transaction("rw", TABELAS_DADOS.map(tabela), async () => {
    for (const nome of TABELAS_DADOS) {
      if (nome === "config") continue;
      await tabela(nome).clear();
    }
    for (const [nome, linhas] of Object.entries(registros)) {
      if (linhas.length) await tabela(nome as keyof RegistrosImportados).bulkPut(linhas);
    }
  });
}
