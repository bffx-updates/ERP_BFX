import { CircleCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";

export type Icone = LucideIcon | ComponentType<{ className?: string; strokeWidth?: number }>;

export function Cabecalho(props: {
  sobretitulo: string;
  titulo: string;
  descricao?: ReactNode;
  meta?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <header className="cabecalho">
      <div className="cabecalho-texto">
        <div className="sobretitulo">{props.sobretitulo}</div>
        <h1 className="titulo">{props.titulo}</h1>
        {props.descricao && <p className="cabecalho-desc">{props.descricao}</p>}
        {props.meta && <div className="cabecalho-meta">{props.meta}</div>}
      </div>
      {props.acoes && <div className="acoes nao-imprimir">{props.acoes}</div>}
    </header>
  );
}

export function Cartao(props: {
  titulo?: string;
  sub?: ReactNode;
  icone?: Icone;
  acoes?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const Simbolo = props.icone;
  return (
    <section className={`cartao ${props.className ?? ""}`}>
      {(props.titulo || props.acoes) && (
        <div className="cartao-cabeca">
          {Simbolo && (
            <span className="cartao-icone" aria-hidden="true">
              <Simbolo />
            </span>
          )}
          <div className="cartao-titulos">
            {props.titulo && <h2 className="cartao-titulo">{props.titulo}</h2>}
            {props.sub && <p className="cartao-sub">{props.sub}</p>}
          </div>
          {props.acoes && <div className="cartao-acoes">{props.acoes}</div>}
        </div>
      )}
      {props.children}
    </section>
  );
}

export interface ItemFaixa {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
}

// Números lado a lado, separados por filetes, como um painel de medidores.
export function Faixa({ itens, colunas = itens.length }: { itens: ItemFaixa[]; colunas?: number }) {
  return (
    <div className="faixa" data-colunas={colunas} style={{ "--colunas": colunas } as CSSProperties}>
      {itens.map((i) => (
        <div key={i.rotulo} className="faixa-celula">
          <div className="legenda">{i.rotulo}</div>
          <div className="faixa-valor">{i.valor}</div>
          {i.detalhe && <div className="faixa-detalhe">{i.detalhe}</div>}
        </div>
      ))}
    </div>
  );
}

export type CorLed = "laranja" | "verde" | "ambar" | "vermelho" | "apagado";

// Status sempre como um LED de footswitch: aceso na cor do estado, apagado quando inativo.
export function Led({ cor = "laranja", pulsando, titulo }: { cor?: CorLed; pulsando?: boolean; titulo?: string }) {
  return (
    <span
      className={`led ${cor === "laranja" ? "" : `led-${cor}`} ${pulsando ? "led-pulsando" : ""}`}
      title={titulo}
      aria-hidden={titulo ? undefined : true}
    />
  );
}

export function Status({ cor, children, title }: { cor: CorLed; children: ReactNode; title?: string }) {
  return (
    <span className="status" title={title}>
      <Led cor={cor} />
      {children}
    </span>
  );
}

export function Tag(props: { children: ReactNode; codigo?: boolean; destaque?: boolean; title?: string }) {
  return (
    <span className={`tag ${props.codigo ? "tag-codigo" : ""} ${props.destaque ? "tag-destaque" : ""}`} title={props.title}>
      {props.children}
    </span>
  );
}

export function Aviso(props: { titulo?: string; erro?: boolean; children?: ReactNode; acao?: ReactNode }) {
  return (
    <div className={`aviso ${props.erro ? "erro" : ""}`} role={props.erro ? "alert" : undefined}>
      <TriangleAlert aria-hidden="true" />
      <div className="aviso-corpo">
        {props.titulo && <div className="aviso-titulo">{props.titulo}</div>}
        {props.children}
      </div>
      {props.acao}
    </div>
  );
}

export function Vazio(props: { icone: Icone; titulo: string; texto?: ReactNode; acao?: ReactNode }) {
  const Simbolo = props.icone;
  return (
    <div className="cartao vazio">
      <div className="vazio-icone" aria-hidden="true">
        <Simbolo />
      </div>
      <h2>{props.titulo}</h2>
      {props.texto && <p>{props.texto}</p>}
      {props.acao}
    </div>
  );
}

// ---------- Confirmação e avisos rápidos ----------

interface PedidoConfirmacao {
  titulo: string;
  texto: string;
  confirmar: string;
  perigo?: boolean;
}

interface Feedback {
  confirmar(p: PedidoConfirmacao): Promise<boolean>;
  avisar(texto: string, erro?: boolean): void;
}

const FeedbackCtx = createContext<Feedback | null>(null);

export function useFeedback(): Feedback {
  const ctx = useContext(FeedbackCtx);
  if (!ctx) throw new Error("useFeedback fora do FeedbackProvider");
  return ctx;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<(PedidoConfirmacao & { responder(ok: boolean): void }) | null>(null);
  const [toast, setToast] = useState<{ texto: string; erro?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const confirmar = useCallback(
    (p: PedidoConfirmacao) =>
      new Promise<boolean>((ok) => {
        setPedido({ ...p, responder: ok });
      }),
    [],
  );
  const avisar = useCallback((texto: string, erro?: boolean) => {
    clearTimeout(timer.current);
    setToast({ texto, erro });
    timer.current = setTimeout(() => setToast(null), erro ? 6000 : 3000);
  }, []);

  const fechar = (ok: boolean) => {
    pedido?.responder(ok);
    setPedido(null);
  };

  useEffect(() => {
    if (!pedido) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && fechar(false);
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  return (
    <FeedbackCtx.Provider value={{ confirmar, avisar }}>
      {children}
      {pedido && (
        <div className="modal-fundo" onClick={() => fechar(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-titulo" onClick={(e) => e.stopPropagation()}>
            <h2 id="modal-titulo">{pedido.titulo}</h2>
            <p>{pedido.texto}</p>
            <div className="acoes">
              <button className="botao fantasma" onClick={() => fechar(false)}>
                Cancelar
              </button>
              <button className={`botao ${pedido.perigo ? "perigo-cheio" : "primario"}`} onClick={() => fechar(true)} autoFocus>
                {pedido.confirmar}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast.erro ? <Led cor="vermelho" /> : <CircleCheck size={16} className="toast-ok" aria-hidden="true" />}
          {toast.texto}
        </div>
      )}
    </FeedbackCtx.Provider>
  );
}
