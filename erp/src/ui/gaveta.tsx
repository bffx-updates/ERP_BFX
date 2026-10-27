// Gaveta lateral para criar e editar registros sem sair da lista.
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AcaoBloqueada } from "../data/acoes";
import { useFeedback } from "./base";
import { useProtegerSaida } from "./rota";

export function Gaveta(props: {
  titulo: string;
  sub?: ReactNode;
  aoFechar: () => void;
  aoSalvar?: () => Promise<unknown> | unknown;
  rotuloSalvar?: string;
  rodapeEsquerda?: ReactNode;
  rodape?: ReactNode; // substitui os botões padrão
  sujo?: boolean;
  larga?: boolean;
  children: ReactNode;
}) {
  const { confirmar, avisar } = useFeedback();
  const [salvando, setSalvando] = useState(false);
  const formId = useId();
  const painel = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  useProtegerSaida(!!props.sujo);

  const fechar = async () => {
    if (props.sujo && !(await confirmar({ titulo: "Descartar alterações?", texto: "O que você mudou aqui ainda não foi salvo.", confirmar: "Descartar", perigo: true }))) return;
    props.aoFechar();
  };

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-fundo")) void fechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  useEffect(() => {
    document.body.classList.add("sem-rolagem");
    const primeiro = painel.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select, textarea");
    primeiro?.focus({ preventScroll: true });
    return () => document.body.classList.remove("sem-rolagem");
  }, []);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!props.aoSalvar || salvando) return;
    setSalvando(true);
    try {
      await props.aoSalvar();
    } catch (erro) {
      avisar(erro instanceof AcaoBloqueada || erro instanceof Error ? erro.message : "Não foi possível salvar.", true);
    } finally {
      setSalvando(false);
    }
  };

  return createPortal(
    <div className="gaveta-fundo" onMouseDown={(e) => e.target === e.currentTarget && void fechar()}>
      <div className={`gaveta ${props.larga ? "larga" : ""}`} role="dialog" aria-modal="true" aria-labelledby={tituloId} ref={painel}>
        <header className="gaveta-cabeca">
          <div className="gaveta-titulos">
            <h2 id={tituloId}>{props.titulo}</h2>
            {props.sub && <p>{props.sub}</p>}
          </div>
          <button type="button" className="botao fantasma icone" aria-label="Fechar" onClick={() => void fechar()}>
            <X aria-hidden="true" />
          </button>
        </header>
        <form id={formId} className="gaveta-corpo" onSubmit={enviar} noValidate>
          {props.children}
        </form>
        <footer className="gaveta-rodape">
          <div className="gaveta-rodape-esq">{props.rodapeEsquerda}</div>
          {props.rodape ?? (
            <div className="acoes">
              <button type="button" className="botao fantasma" onClick={() => void fechar()}>
                Cancelar
              </button>
              {props.aoSalvar && (
                <button type="submit" form={formId} className="botao primario" disabled={salvando}>
                  {salvando ? "Salvando…" : (props.rotuloSalvar ?? "Salvar")}
                </button>
              )}
            </div>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// Abas de uma página; cada aba tem endereço próprio (#/estoque/movimentacoes).
export function Abas({ abas, ativa, base }: { abas: { id: string; rotulo: string; contagem?: number }[]; ativa: string; base: string }) {
  return (
    <nav className="abas" aria-label="Seções da página">
      {abas.map((a, i) => (
        <a key={a.id} href={i === 0 ? `#/${base}` : `#/${base}/${a.id}`} className={`aba ${ativa === a.id ? "ativa" : ""}`} aria-current={ativa === a.id ? "page" : undefined}>
          {a.rotulo}
          {a.contagem != null && <span className="aba-conta">{a.contagem}</span>}
        </a>
      ))}
    </nav>
  );
}

// Executa uma ação e mostra o erro (ex.: "desative em vez de excluir") num aviso rápido.
export function useExecutar() {
  const { avisar } = useFeedback();
  return async <T,>(acao: () => Promise<T>, sucesso?: string): Promise<T | undefined> => {
    try {
      const r = await acao();
      if (sucesso) avisar(sucesso);
      return r;
    } catch (erro) {
      avisar(erro instanceof Error ? erro.message : "Algo deu errado.", true);
      return undefined;
    }
  };
}
