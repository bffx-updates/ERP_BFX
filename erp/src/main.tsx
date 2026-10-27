import "@fontsource/michroma/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./estilos.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { iniciarSincronizacao } from "./backup/sincronizacao";
import { DEMO } from "./demo";

// Pede ao navegador para não apagar os dados sozinho quando faltar espaço em disco.
void navigator.storage?.persist?.();
if (DEMO) void import("./demoCarregar").then((m) => m.carregarDemonstracao());
else void iniciarSincronizacao();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
