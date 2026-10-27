import { Cpu, DatabaseBackup, FileSpreadsheet, Gauge, Layers, Package, ShoppingCart, Truck, Wrench } from "lucide-react";
import { useEffect, type ComponentType } from "react";
import { reativarPasta, useStatusSincronizacao } from "./backup/sincronizacao";
import { haQuanto } from "./data/formato";
import { Componentes } from "./paginas/Componentes";
import { Compras } from "./paginas/Compras";
import { Contabilidade } from "./paginas/Contabilidade";
import { Dados } from "./paginas/Dados";
import { Estoque } from "./paginas/Estoque";
import { Fornecedores } from "./paginas/Fornecedores";
import { Lotes } from "./paginas/Lotes";
import { Painel } from "./paginas/Painel";
import { Producao } from "./paginas/Producao";
import { Produtos } from "./paginas/Produtos";
import { Relatorio } from "./paginas/Relatorio";
import { DEMO } from "./demo";
import { AvisosSincronizacao } from "./ui/AvisosSincronizacao";
import { FeedbackProvider, Led, useFeedback, type CorLed, type Icone } from "./ui/base";
import { IconePedal } from "./ui/icones";
import { haAlteracoesPendentes, liberarSaida, useLocal } from "./ui/rota";
import { SeletorTema } from "./ui/tema";

interface Rota {
  id: string;
  nome: string;
  icone: Icone;
  pagina: ComponentType;
}

const GRUPOS: { titulo?: string; rotas: Rota[] }[] = [
  { rotas: [{ id: "painel", nome: "Painel", icone: Gauge, pagina: Painel }] },
  {
    titulo: "Operação",
    rotas: [
      { id: "compras", nome: "Compras", icone: ShoppingCart, pagina: Compras },
      { id: "estoque", nome: "Estoque", icone: Package, pagina: Estoque },
      { id: "lotes", nome: "Lotes", icone: Layers, pagina: Lotes },
      { id: "producao", nome: "Produção e custos", icone: Wrench, pagina: Producao },
    ],
  },
  {
    titulo: "Cadastros",
    rotas: [
      { id: "produtos", nome: "Produtos", icone: IconePedal, pagina: Produtos },
      { id: "componentes", nome: "Componentes", icone: Cpu, pagina: Componentes },
      { id: "fornecedores", nome: "Fornecedores", icone: Truck, pagina: Fornecedores },
    ],
  },
  {
    titulo: "Gestão",
    rotas: [
      { id: "contabilidade", nome: "Contabilidade", icone: FileSpreadsheet, pagina: Contabilidade },
      { id: "dados", nome: "Dados e backup", icone: DatabaseBackup, pagina: Dados },
    ],
  },
];

const ROTAS = GRUPOS.flatMap((g) => g.rotas);
// Telas sem item no menu: acendem o item da seção a que pertencem.
const EXTRAS: Record<string, Rota & { secao: string }> = {
  relatorio: { id: "relatorio", nome: "Relatório", icone: FileSpreadsheet, pagina: Relatorio, secao: "contabilidade" },
};

// Na demonstração não há sincronização: o rodapé só lembra que os dados são fictícios.
function StatusDemonstracao() {
  return (
    <a className="backup" href="#/dados" title="Demonstração com dados fictícios, separada do ERP de verdade">
      <Led cor="laranja" />
      <span className="backup-texto">
        <span className="backup-titulo">Demonstração</span>
        <span className="backup-detalhe">Dados fictícios, sem sincronizar</span>
      </span>
    </a>
  );
}

function FaixaDemonstracao() {
  const { confirmar, avisar } = useFeedback();
  return (
    <div className="faixa-demo nao-imprimir">
      <Led cor="laranja" />
      <span className="faixa-demo-texto">
        <strong>Demonstração.</strong> Dados fictícios, num banco separado: o que você mudar aqui não toca no ERP de verdade.
      </span>
      <button
        className="botao pequeno"
        onClick={async () => {
          if (!(await confirmar({ titulo: "Recomeçar a demonstração?", texto: "Os dados de demonstração voltam ao original. O ERP de verdade não é afetado.", confirmar: "Recomeçar" }))) return;
          const { carregarDemonstracao } = await import("./demoCarregar");
          await carregarDemonstracao(true);
          avisar("Demonstração recomeçada.");
        }}
      >
        Recomeçar
      </button>
    </div>
  );
}

function StatusSincronizacao() {
  const s = useStatusSincronizacao();
  const { avisar } = useFeedback();
  let cor: CorLed = "verde";
  let pulsando = false;
  let titulo = "Sincronizado";
  let detalhe = s.ultimo ? `${s.nomePasta ?? "Pasta"} · ${haQuanto(s.ultimo)}` : (s.nomePasta ?? "Pasta");
  if (s.pasta === "sem_suporte") {
    cor = "ambar";
    titulo = "Sincronização indisponível";
    detalhe = "Use o Chrome ou o Edge";
  } else if (s.pasta === "nao_configurada") {
    cor = "ambar";
    titulo = "Sincronização desligada";
    detalhe = "Escolha uma pasta";
  } else if (s.pasta === "precisa_permissao") {
    cor = "ambar";
    titulo = "Pasta desconectada";
    detalhe = "Clique para conectar";
  } else if (s.conflito || s.copia) {
    cor = "vermelho";
    titulo = "Conflito na sincronização";
    detalhe = "Escolha qual versão fica";
  } else if (s.erro) {
    cor = "vermelho";
    titulo = "Falha na sincronização";
    detalhe = s.erro;
  } else if (s.ocupado || s.pendente) {
    cor = "laranja";
    pulsando = true;
    titulo = "Sincronizando…";
    detalhe = s.nomePasta ?? "Pasta";
  }

  const aoClicar = async () => {
    if (s.pasta === "precisa_permissao") {
      const ok = await reativarPasta();
      if (!ok) avisar("Permissão negada. A pasta continua desconectada.", true);
    } else {
      window.location.hash = "#/dados";
    }
  };

  return (
    <button className="backup" onClick={aoClicar} title={`${titulo} — ${detalhe}`} aria-label={`${titulo}: ${detalhe}`}>
      <Led cor={cor} pulsando={pulsando} />
      <span className="backup-texto">
        <span className="backup-titulo">{titulo}</span>
        <span className="backup-detalhe">{detalhe}</span>
      </span>
    </button>
  );
}

// Clicar num link interno com alterações não salvas pergunta antes de sair.
function ProtecaoDeSaida() {
  const { confirmar } = useFeedback();
  useEffect(() => {
    const clique = async (e: MouseEvent) => {
      if (!haAlteracoesPendentes() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      if (!link || link.target === "_blank") return;
      const destino = link.getAttribute("href") ?? "";
      if (!destino || destino === window.location.hash) return;
      e.preventDefault();
      e.stopPropagation();
      if (await confirmar({ titulo: "Sair sem salvar?", texto: "O que você mudou aqui ainda não foi salvo.", confirmar: "Sair sem salvar", perigo: true })) {
        liberarSaida();
        window.location.hash = destino;
      }
    };
    const antesDeFechar = (e: BeforeUnloadEvent) => {
      if (!haAlteracoesPendentes()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("click", clique, true);
    window.addEventListener("beforeunload", antesDeFechar);
    return () => {
      document.removeEventListener("click", clique, true);
      window.removeEventListener("beforeunload", antesDeFechar);
    };
  }, [confirmar]);
  return null;
}

export function App() {
  const local = useLocal();
  const extra = EXTRAS[local.secao];
  const rota = extra ?? ROTAS.find((r) => r.id === local.secao) ?? ROTAS[0];
  const secaoAtiva = extra?.secao ?? rota.id;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [rota.id]);

  useEffect(() => {
    document.title = `${rota.nome} · BFX Technologies ERP${DEMO ? " (demonstração)" : ""}`;
  }, [rota]);

  const Pagina = rota.pagina;
  return (
    <FeedbackProvider>
      <ProtecaoDeSaida />
      <aside className="lateral">
        <div className="lateral-topo">
          <div className="lateral-topo-linha">
            <div className="marca" aria-label="BFX Technologies ERP">
              <span className="marca-selo">BFX</span>
              <span className="marca-erp">ERP</span>
            </div>
            <SeletorTema />
          </div>
          <div className="marca-sub">
            <span className="marca-empresa">BFX Technologies</span>
            Gestão da produção BFMiDi
          </div>
        </div>
        <nav className="nav" aria-label="Seções">
          {GRUPOS.map((g, i) => (
            <div key={g.titulo ?? i} style={{ display: "contents" }}>
              {g.titulo && <div className="nav-grupo legenda">{g.titulo}</div>}
              {g.rotas.map((r) => {
                const ativo = r.id === secaoAtiva;
                const Simbolo = r.icone;
                return (
                  <a key={r.id} href={`#/${r.id}`} className={`nav-item ${ativo ? "ativo" : ""}`} aria-current={ativo ? "page" : undefined}>
                    <Simbolo />
                    {r.nome}
                    {ativo && <Led />}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="lateral-rodape">
          {DEMO ? <StatusDemonstracao /> : <StatusSincronizacao />}
        </div>
      </aside>
      <main className="conteudo">
        <div className="conteudo-limite">
          {DEMO ? <FaixaDemonstracao /> : <AvisosSincronizacao />}
          <div className="conteudo-interno" key={rota.id}>
            <Pagina />
          </div>
        </div>
      </main>
    </FeedbackProvider>
  );
}
