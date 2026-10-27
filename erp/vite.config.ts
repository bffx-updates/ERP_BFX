import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Gera um único index.html (JS, CSS, fontes e imagens embutidos)
// para o app abrir com dois cliques, direto do disco, sem servidor.
// "vite build --mode demo" gera a versão de demonstração em dist-demo/.
export default defineConfig(({ mode }) => ({
  plugins: [react(), viteSingleFile()],
  build: { outDir: mode === "demo" ? "dist-demo" : "dist", emptyOutDir: true },
  test: { environment: "node" },
}));
