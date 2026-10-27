import { restaurarSnapshot, type Snapshot } from "./backup/snapshot";
import { contarDadosDaEmpresa } from "./data/db";

// Carrega os dados de demonstração (demo/backup-demonstracao.json, embutido só na versão de demonstração).
export async function carregarDemonstracao(forcar = false): Promise<void> {
  if (!forcar && (await contarDadosDaEmpresa()) > 0) return;
  const { default: dados } = await import("../demo/backup-demonstracao.json");
  await restaurarSnapshot(dados as unknown as Snapshot);
}
