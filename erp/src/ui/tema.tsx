// Tema claro/escuro. O padrão é o claro; a escolha é uma preferência deste navegador (não vai
// para o backup) e é aplicada por um script no index.html antes da primeira pintura.
// A chave mudou de "bffx.tema" para "bfx.tema": quem tinha escolhido o escuro antes volta ao claro.
import { Moon, Sun } from "lucide-react";
import { useState } from "react";

export type Tema = "escuro" | "claro";

const CHAVE = "bfx.tema";
const COR_DA_BARRA: Record<Tema, string> = { escuro: "#0b0c0f", claro: "#eef0f3" };

export function temaAtual(): Tema {
  return document.documentElement.dataset.tema === "claro" ? "claro" : "escuro";
}

export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    raiz.classList.add("tema-transicao");
    window.setTimeout(() => raiz.classList.remove("tema-transicao"), 300);
  }
  raiz.dataset.tema = tema;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COR_DA_BARRA[tema]);
  try {
    localStorage.setItem(CHAVE, tema);
  } catch {
    // Sem acesso ao armazenamento: o tema vale só até fechar o app.
  }
}

export function SeletorTema() {
  const [tema, setTema] = useState<Tema>(temaAtual);

  const escolher = (novo: Tema) => {
    if (novo === tema) return;
    aplicarTema(novo);
    setTema(novo);
  };

  return (
    <div className="tema" role="group" aria-label="Tema">
      <button type="button" aria-pressed={tema === "escuro"} aria-label="Tema escuro" title="Tema escuro" onClick={() => escolher("escuro")}>
        <Moon aria-hidden="true" />
      </button>
      <button type="button" aria-pressed={tema === "claro"} aria-label="Tema claro" title="Tema claro" onClick={() => escolher("claro")}>
        <Sun aria-hidden="true" />
      </button>
    </div>
  );
}
