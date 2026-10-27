// Copia o app compilado para a pasta principal, ao lado do app antigo, para abrir com dois cliques:
//   "BFX Technologies ERP.html"                  (npm run build)
//   "BFX Technologies ERP (demonstração).html"   (npm run build:demo)
// A demonstração também vai para docs/index.html, a página publicada no GitHub Pages.
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const demo = process.argv.includes("demo");
const origem = fileURLToPath(new URL(demo ? "../dist-demo/index.html" : "../dist/index.html", import.meta.url));
const destinos = demo
  ? ["../../BFX Technologies ERP (demonstração).html", "../../docs/index.html"]
  : ["../../BFX Technologies ERP.html"];
for (const d of destinos) {
  const destino = fileURLToPath(new URL(d, import.meta.url));
  mkdirSync(fileURLToPath(new URL(".", new URL(d, import.meta.url))), { recursive: true });
  copyFileSync(origem, destino);
  console.log(`✓ Publicado em: ${destino}`);
}
