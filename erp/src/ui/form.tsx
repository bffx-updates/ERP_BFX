// Campos de formulário. Números são digitados do jeito brasileiro ("1.234,56") e chegam como number.
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { combina, lerNumero, paraEntrada } from "../data/formato";

export function Campo(props: { rotulo: string; dica?: ReactNode; erro?: string | false; inteiro?: boolean; htmlFor?: string; children: ReactNode; opcional?: boolean }) {
  return (
    <div className={`campo ${props.inteiro ? "campo-inteiro" : ""} ${props.erro ? "com-erro" : ""}`}>
      <label htmlFor={props.htmlFor}>
        {props.rotulo}
        {props.opcional && <span className="opcional">opcional</span>}
      </label>
      {props.children}
      {props.erro ? <div className="campo-erro">{props.erro}</div> : props.dica ? <div className="campo-dica">{props.dica}</div> : null}
    </div>
  );
}

type BaseInput = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "prefix">;

export function Texto({ valor, aoMudar, className, ...resto }: BaseInput & { valor: string | undefined; aoMudar: (v: string) => void }) {
  return <input className={`entrada ${className ?? ""}`} value={valor ?? ""} onChange={(e) => aoMudar(e.target.value)} {...resto} />;
}

export function AreaTexto({ valor, aoMudar, linhas = 3, id, placeholder }: { valor: string | undefined; aoMudar: (v: string) => void; linhas?: number; id?: string; placeholder?: string }) {
  return <textarea id={id} className="entrada area" rows={linhas} value={valor ?? ""} placeholder={placeholder} onChange={(e) => aoMudar(e.target.value)} />;
}

export function Numero({
  valor,
  aoMudar,
  casas,
  prefixo,
  sufixo,
  className,
  ...resto
}: BaseInput & { valor: number | null | undefined; aoMudar: (v: number | null) => void; casas?: number; prefixo?: string; sufixo?: string }) {
  const [texto, setTexto] = useState(() => paraEntrada(valor, casas));
  const focado = useRef(false);
  useEffect(() => {
    if (!focado.current) setTexto(paraEntrada(valor, casas));
  }, [valor, casas]);
  const input = (
    <input
      inputMode="decimal"
      autoComplete="off"
      className={`entrada num ${prefixo || sufixo ? "" : className ?? ""}`}
      value={texto}
      onFocus={(e) => {
        focado.current = true;
        e.target.select();
      }}
      onChange={(e) => {
        setTexto(e.target.value);
        aoMudar(lerNumero(e.target.value));
      }}
      onBlur={() => {
        focado.current = false;
        setTexto(paraEntrada(lerNumero(texto), casas));
      }}
      {...resto}
    />
  );
  if (!prefixo && !sufixo) return input;
  return (
    <div className={`entrada-grupo ${className ?? ""}`}>
      {prefixo && <span className="entrada-afixo">{prefixo}</span>}
      {input}
      {sufixo && <span className="entrada-afixo">{sufixo}</span>}
    </div>
  );
}

export const Moeda = (p: Omit<Parameters<typeof Numero>[0], "prefixo" | "casas"> & { casas?: number }) => <Numero prefixo="R$" casas={p.casas ?? 2} {...p} />;

export function Data({ valor, aoMudar, ...resto }: BaseInput & { valor: string; aoMudar: (v: string) => void }) {
  return <input type="date" className="entrada" value={valor} onChange={(e) => aoMudar(e.target.value)} {...resto} />;
}

export interface Opcao<T extends string = string> {
  valor: T;
  rotulo: string;
  detalhe?: string;
  grupo?: string;
}

export function Selecao<T extends string>({ valor, aoMudar, opcoes, id, vazio }: { valor: T; aoMudar: (v: T) => void; opcoes: Opcao<T>[]; id?: string; vazio?: string }) {
  const grupos = new Map<string, Opcao<T>[]>();
  for (const o of opcoes) grupos.set(o.grupo ?? "", [...(grupos.get(o.grupo ?? "") ?? []), o]);
  return (
    <select id={id} className="entrada" value={valor} onChange={(e) => aoMudar(e.target.value as T)}>
      {vazio !== undefined && <option value="">{vazio}</option>}
      {[...grupos].map(([g, lista]) =>
        g ? (
          <optgroup key={g} label={g}>
            {lista.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </optgroup>
        ) : (
          lista.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))
        ),
      )}
    </select>
  );
}

// Poucas opções curtas: botões lado a lado, a escolhida fica acesa.
export function Segmentado<T extends string>({ valor, aoMudar, opcoes, rotulo }: { valor: T; aoMudar: (v: T) => void; opcoes: Opcao<T>[]; rotulo?: string }) {
  return (
    <div className="segmentado" role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button key={o.valor} type="button" role="radio" aria-checked={valor === o.valor} title={o.detalhe} onClick={() => aoMudar(o.valor)}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

export function Interruptor({ ligado, aoMudar, rotulo, descricao }: { ligado: boolean; aoMudar: (v: boolean) => void; rotulo: string; descricao?: ReactNode }) {
  const id = useId();
  return (
    <label className="interruptor" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={ligado} onChange={(e) => aoMudar(e.target.checked)} />
      <span className="interruptor-trilho" aria-hidden="true" />
      <span className="interruptor-texto">
        <span className="interruptor-rotulo">{rotulo}</span>
        {descricao && <span className="interruptor-desc">{descricao}</span>}
      </span>
    </label>
  );
}

// Escolha com busca: digita parte do nome e escolhe na lista. Pode oferecer "criar novo".
export function Escolha({
  valor,
  aoMudar,
  opcoes,
  placeholder = "Escolha…",
  aoCriar,
  rotuloCriar = "Criar",
  id,
  invalido,
  autoFocus,
}: {
  valor: string | undefined;
  aoMudar: (v: string) => void;
  opcoes: Opcao[];
  placeholder?: string;
  aoCriar?: (texto: string) => void;
  rotuloCriar?: string;
  id?: string;
  invalido?: boolean;
  autoFocus?: boolean;
}) {
  const atual = opcoes.find((o) => o.valor === valor);
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [destaque, setDestaque] = useState(0);
  const [pos, setPos] = useState<CSSProperties>({});
  const caixa = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const listaId = useId();

  const filtradas = useMemo(() => opcoes.filter((o) => combina(busca, o.rotulo, o.detalhe, o.grupo)), [opcoes, busca]);
  const podeCriar = !!aoCriar && busca.trim().length > 1 && !opcoes.some((o) => o.rotulo.toLowerCase() === busca.trim().toLowerCase());
  const total = filtradas.length + (podeCriar ? 1 : 0);

  // A lista abre por cima de tudo (fora de tabelas com rolagem), presa ao campo.
  useLayoutEffect(() => {
    if (!aberto) return;
    const posicionar = () => {
      const r = caixa.current?.getBoundingClientRect();
      if (!r) return;
      const abaixo = window.innerHeight - r.bottom;
      const altura = Math.min(300, Math.max(abaixo, r.top) - 16);
      const paraCima = abaixo < 220 && r.top > abaixo;
      setPos({ left: r.left, width: Math.max(r.width, 280), maxHeight: altura, ...(paraCima ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    };
    posicionar();
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!caixa.current?.contains(alvo) && !lista.current?.contains(alvo)) fechar();
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  });

  useEffect(() => {
    lista.current?.querySelector(`[data-indice="${destaque}"]`)?.scrollIntoView({ block: "nearest" });
  }, [destaque]);

  function fechar() {
    setAberto(false);
    setBusca("");
  }

  function escolher(i: number) {
    if (i < filtradas.length) aoMudar(filtradas[i].valor);
    else if (podeCriar) aoCriar!(busca.trim());
    fechar();
  }

  const tecla = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!aberto) setAberto(true);
      setDestaque((d) => Math.min(total - 1, d + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDestaque((d) => Math.max(0, d - 1));
    } else if (e.key === "Enter" && aberto) {
      e.preventDefault();
      if (total) escolher(destaque);
    } else if (e.key === "Escape" && aberto) {
      e.stopPropagation();
      fechar();
    } else if (e.key === "Tab" && aberto) {
      fechar();
    }
  };

  let grupoAnterior: string | undefined;
  return (
    <div className={`escolha ${aberto ? "aberta" : ""} ${invalido ? "invalida" : ""}`} ref={caixa}>
      <Search className="escolha-lupa" aria-hidden="true" />
      <input
        id={id}
        className="entrada"
        role="combobox"
        aria-expanded={aberto}
        aria-controls={listaId}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={atual ? atual.rotulo : placeholder}
        value={aberto ? busca : (atual?.rotulo ?? "")}
        onFocus={() => {
          setAberto(true);
          setDestaque(Math.max(0, filtradas.findIndex((o) => o.valor === valor)));
        }}
        onClick={() => setAberto(true)}
        onChange={(e) => {
          setBusca(e.target.value);
          setDestaque(0);
          setAberto(true);
        }}
        onKeyDown={tecla}
      />
      <ChevronDown className="escolha-seta" aria-hidden="true" />
      {aberto &&
        createPortal(
          <ul className="escolha-lista" id={listaId} role="listbox" ref={lista} style={pos}>
            {filtradas.map((o, i) => {
              const cabeca = o.grupo && o.grupo !== grupoAnterior ? o.grupo : null;
              grupoAnterior = o.grupo;
              return (
                <li key={o.valor} role="presentation">
                  {cabeca && <div className="escolha-grupo legenda">{cabeca}</div>}
                  <div
                    role="option"
                    aria-selected={o.valor === valor}
                    data-indice={i}
                    className={`escolha-opcao ${i === destaque ? "destaque" : ""}`}
                    onMouseEnter={() => setDestaque(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      escolher(i);
                    }}
                  >
                    <span className="escolha-textos">
                      <span>{o.rotulo}</span>
                      {o.detalhe && <span className="escolha-detalhe">{o.detalhe}</span>}
                    </span>
                    {o.valor === valor && <Check aria-hidden="true" />}
                  </div>
                </li>
              );
            })}
            {podeCriar && (
              <li role="presentation">
                <div
                  role="option"
                  aria-selected={false}
                  data-indice={filtradas.length}
                  className={`escolha-opcao escolha-criar ${destaque === filtradas.length ? "destaque" : ""}`}
                  onMouseEnter={() => setDestaque(filtradas.length)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    escolher(filtradas.length);
                  }}
                >
                  <Plus aria-hidden="true" />
                  {rotuloCriar} “{busca.trim()}”
                </div>
              </li>
            )}
            {!total && <li className="escolha-nada">Nada encontrado</li>}
          </ul>,
          document.body,
        )}
    </div>
  );
}

// Estado de um formulário: valores, alteração por campo e se algo mudou desde que abriu.
export function useFormulario<T extends object>(inicial: T) {
  const [valores, setValores] = useState<T>(inicial);
  const [sujo, setSujo] = useState(false);
  const [tentou, setTentou] = useState(false); // só mostra erros depois da primeira tentativa de salvar
  const mudar = <K extends keyof T>(campo: K, valor: T[K]) => {
    setValores((v) => ({ ...v, [campo]: valor }));
    setSujo(true);
  };
  return { valores, mudar, sujo, setSujo, setValores, tentou, setTentou };
}

// Campo de busca para listas.
export function Busca({ valor, aoMudar, placeholder = "Buscar…" }: { valor: string; aoMudar: (v: string) => void; placeholder?: string }) {
  return (
    <div className="busca">
      <Search aria-hidden="true" />
      <input type="search" className="entrada" placeholder={placeholder} value={valor} onChange={(e) => aoMudar(e.target.value)} aria-label={placeholder} />
      {valor && (
        <button type="button" className="busca-limpar" aria-label="Limpar busca" onClick={() => aoMudar("")}>
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export interface Filtro {
  id: string;
  rotulo: string;
  contagem?: number;
  alerta?: boolean;
}

// Filtros rápidos de uma lista: um ativo por vez.
export function Filtros({ opcoes, ativo, aoMudar }: { opcoes: Filtro[]; ativo: string; aoMudar: (id: string) => void }) {
  return (
    <div className="filtros" role="tablist">
      {opcoes.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={ativo === o.id} className={`filtro ${o.alerta && o.contagem ? "alerta" : ""}`} onClick={() => aoMudar(o.id)}>
          {o.rotulo}
          {o.contagem != null && <span className="filtro-conta">{o.contagem}</span>}
        </button>
      ))}
    </div>
  );
}
