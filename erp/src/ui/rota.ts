// Rotas pelo endereço depois do "#": #/secao/parte?filtro=x. Funciona abrindo o arquivo direto do disco.
import { useEffect, useRef, useSyncExternalStore } from "react";

export interface Local {
  secao: string;
  partes: string[];
  query: URLSearchParams;
  hash: string;
}

let cache: Local | undefined;

function lerLocal(): Local {
  const hash = window.location.hash;
  if (cache && cache.hash === hash) return cache;
  const [caminho, busca = ""] = hash.replace(/^#\/?/, "").split("?");
  const [secao = "", ...partes] = caminho.split("/").filter(Boolean).map(decodeURIComponent);
  cache = { secao, partes, query: new URLSearchParams(busca), hash };
  return cache;
}

function assinar(f: () => void) {
  window.addEventListener("hashchange", f);
  return () => window.removeEventListener("hashchange", f);
}

export function useLocal(): Local {
  return useSyncExternalStore(assinar, lerLocal);
}

export function ir(caminho: string): void {
  const alvo = caminho.startsWith("#") ? caminho : `#${caminho.startsWith("/") ? "" : "/"}${caminho}`;
  if (window.location.hash !== alvo) window.location.hash = alvo;
}

// Troca só o filtro da lista, sem empilhar no histórico do navegador.
export function trocarQuery(chave: string, valor: string | undefined): void {
  const { secao, partes, query } = lerLocal();
  const q = new URLSearchParams(query);
  if (valor) q.set(chave, valor);
  else q.delete(chave);
  const texto = q.toString();
  const novo = `#/${[secao, ...partes].map(encodeURIComponent).join("/")}${texto ? `?${texto}` : ""}`;
  history.replaceState(null, "", novo);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

// Telas com alterações ainda não salvas. Links internos perguntam antes de sair (ver App.tsx)
// e fechar a janela pede confirmação ao navegador.
const pendentes = new Set<symbol>();

export function useProtegerSaida(sujo: boolean): void {
  const chave = useRef(Symbol("tela"));
  useEffect(() => {
    const k = chave.current;
    if (sujo) pendentes.add(k);
    else pendentes.delete(k);
    return () => {
      pendentes.delete(k);
    };
  }, [sujo]);
}

export const haAlteracoesPendentes = () => pendentes.size > 0;

export function liberarSaida(): void {
  pendentes.clear();
}
