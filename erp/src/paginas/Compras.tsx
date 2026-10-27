import { ArrowLeft, FileCode2, FileText, Paperclip, Plus, ShoppingCart, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { anexarArquivo, excluirCompra, removerAnexo, salvarCompra, salvarFornecedor, type CompraEditavel } from "../data/acoes";
import { custosDeEntrada, quantidadeAReceber, STATUS_EM_ABERTO, totalDaCompra } from "../data/compras";
import { useAnexos, useBase } from "../data/consultas";
import { salvarConfig } from "../data/db";
import {
  brl,
  brlUnit,
  chaveNFeValida,
  combina,
  data,
  diaParaIso,
  formatarChave,
  formatarDocumento,
  hoje,
  isoParaDia,
  mesDe,
  mesLocal,
  nomeDoMes,
  normalizar,
  num,
  plural,
  ROTULOS,
  soDocumento,
} from "../data/formato";
import type { BaseDados } from "../data/relatorios";
import type { Compra, CompraItem, StatusCompra, TipoDocumento } from "../data/tipos";
import { lerNFe, type NotaImportada } from "../importacao/nfe";
import { Aviso, Cabecalho, Cartao, Faixa, Led, Status, useFeedback } from "../ui/base";
import { AreaTexto, Busca, Campo, Data, Escolha, Filtros, Moeda, Numero, Segmentado, Selecao, Texto, useFormulario } from "../ui/form";
import { useExecutar } from "../ui/gaveta";
import { ir, trocarQuery, useLocal, useProtegerSaida } from "../ui/rota";
import { COR_COMPRA, SemDados } from "./comum";
import { EditorComponente } from "./Componentes";
import { EditorFornecedor } from "./Fornecedores";

// Nota lida na lista, entregue ao editor de "nova compra".
let notaPendente: { nota: NotaImportada; arquivo: File } | null = null;

export function Compras() {
  const local = useLocal();
  const base = useBase();
  if (!base) return null;
  if (local.partes[0]) return <EditorCompra key={local.partes[0]} base={base} id={local.partes[0] === "nova" ? undefined : local.partes[0]} />;
  return <ListaCompras base={base} />;
}

function useImportarXml(base: BaseDados) {
  const { avisar } = useFeedback();
  const entrada = useRef<HTMLInputElement>(null);
  const elemento = (
    <input
      ref={entrada}
      type="file"
      accept=".xml,text/xml,application/xml"
      hidden
      onChange={async (e) => {
        const arquivo = e.target.files?.[0];
        e.target.value = "";
        if (!arquivo) return;
        try {
          const nota = lerNFe(await arquivo.text());
          const repetida = nota.chave && base.compras.find((c) => soDocumento(c.chaveNFe) === nota.chave);
          if (repetida) {
            avisar(`Esta nota (NF ${nota.numero}) já foi lançada em ${data(repetida.data)}. Abrindo a compra.`);
            ir(`/compras/${repetida.id}`);
            return;
          }
          notaPendente = { nota, arquivo };
          ir("/compras/nova");
        } catch (erro) {
          avisar(erro instanceof Error ? erro.message : "Não foi possível ler o XML.", true);
        }
      }}
    />
  );
  return { abrir: () => entrada.current?.click(), elemento };
}

const PENDENCIAS: Record<string, string> = {
  sem_documento: "Sem documento",
  sem_chave: "NF-e sem chave",
  cpf: "Compradas no CPF",
  sem_anexo: "Sem arquivo anexado",
};

function ListaCompras({ base }: { base: BaseDados }) {
  const local = useLocal();
  const [busca, setBusca] = useState("");
  const filtro = local.query.get("filtro") ?? "todas";
  const mes = local.query.get("mes") ?? "";
  const xml = useImportarXml(base);

  const linhas = useMemo(
    () =>
      base.compras
        .map((compra) => {
          const itens = base.compraItens.filter((i) => i.compraId === compra.id);
          return {
            compra,
            itens,
            fornecedor: base.fornecedores.find((f) => f.id === compra.fornecedorId),
            lote: base.lotes.find((l) => l.id === compra.loteId),
            total: totalDaCompra(compra, itens),
            anexos: base.anexosPorRef.get(`compra:${compra.id}`) ?? 0,
          };
        })
        .sort((a, b) => b.compra.data.localeCompare(a.compra.data)),
    [base],
  );
  const nomes = useMemo(() => new Map(base.componentes.map((c) => [c.id, c.nome])), [base.componentes]);

  const recebidaNova = (c: Compra) => !c.legado && (c.status === "recebida" || c.status === "recebida_parcial");
  const pendencia = (l: (typeof linhas)[number], tipo: string) => {
    const c = l.compra;
    if (!recebidaNova(c)) return false;
    if (tipo === "sem_documento") return c.documentoTipo === "sem_documento";
    if (tipo === "sem_chave") return c.documentoTipo === "nfe" && !c.chaveNFe;
    if (tipo === "cpf") return c.compradoEm === "cpf";
    if (tipo === "sem_anexo") return c.documentoTipo !== "sem_documento" && !l.anexos;
    return false;
  };
  const temPendencia = (l: (typeof linhas)[number]) => Object.keys(PENDENCIAS).some((t) => pendencia(l, t));

  const meses = [...new Set(linhas.map((l) => mesLocal(l.compra.data)))].sort().reverse();
  const doMes = linhas.filter((l) => !mes || mesLocal(l.compra.data) === mes);
  const visiveis = doMes.filter((l) => {
    const c = l.compra;
    if (filtro === "a_receber" && !STATUS_EM_ABERTO.includes(c.status)) return false;
    if (filtro === "recebidas" && c.status !== "recebida") return false;
    if (filtro === "pendencias" && !temPendencia(l)) return false;
    if (filtro === "legado" && !c.legado) return false;
    if (filtro === "canceladas" && c.status !== "cancelada") return false;
    if (filtro === "rascunhos" && c.status !== "rascunho") return false;
    if (PENDENCIAS[filtro] && !pendencia(l, filtro)) return false;
    return combina(busca, l.fornecedor?.nome, c.numeroNF, c.chaveNFe, c.obs, l.lote?.codigo, ...l.itens.map((i) => nomes.get(i.componenteId)));
  });

  const esteMes = mesDe();
  const validas = linhas.filter((l) => l.compra.status !== "cancelada" && l.compra.status !== "rascunho");
  const noMes = validas.filter((l) => mesLocal(l.compra.data) === esteMes);
  const aReceber = linhas.filter((l) => STATUS_EM_ABERTO.includes(l.compra.status));
  const comPendencia = linhas.filter(temPendencia).length;
  const filtros = [
    { id: "todas", rotulo: "Todas", contagem: doMes.length },
    { id: "a_receber", rotulo: "A receber", contagem: doMes.filter((l) => STATUS_EM_ABERTO.includes(l.compra.status)).length },
    { id: "recebidas", rotulo: "Recebidas" },
    { id: "pendencias", rotulo: "Pendências fiscais", contagem: doMes.filter(temPendencia).length, alerta: true },
    ...(PENDENCIAS[filtro] ? [{ id: filtro, rotulo: PENDENCIAS[filtro], contagem: doMes.filter((l) => pendencia(l, filtro)).length, alerta: true }] : []),
    ...(linhas.some((l) => l.compra.status === "rascunho") ? [{ id: "rascunhos", rotulo: "Rascunhos" }] : []),
    { id: "legado", rotulo: "Do app antigo" },
    { id: "canceladas", rotulo: "Canceladas" },
  ];

  return (
    <>
      {xml.elemento}
      <Cabecalho
        sobretitulo="Operação"
        titulo="Compras"
        descricao="O que foi comprado, de quem, com qual nota e para qual lote. Ao marcar como recebida, as peças entram no estoque com frete e impostos no custo."
        acoes={
          <>
            <button className="botao" onClick={xml.abrir}>
              <FileCode2 aria-hidden="true" />
              Importar XML da NF-e
            </button>
            <button className="botao primario" onClick={() => ir("/compras/nova")}>
              <Plus aria-hidden="true" />
              Nova compra
            </button>
          </>
        }
      />
      <div className="pilha">
        {linhas.length === 0 ? (
          <SemDados
            titulo="Nenhuma compra registrada"
            icone={ShoppingCart}
            texto="Lance uma compra à mão ou importe o XML da nota fiscal do fornecedor: o app preenche fornecedor, itens, frete e impostos."
            novo={{ rotulo: "Nova compra", href: "#/compras/nova" }}
          />
        ) : (
          <>
            <Faixa
              itens={[
                { rotulo: `Comprado em ${nomeDoMes(esteMes).split(" ")[0]}`, valor: brl(noMes.reduce((a, l) => a + l.total, 0)), detalhe: plural(noMes.length, "compra", "compras") },
                {
                  rotulo: "A receber",
                  valor: num(aReceber.length),
                  detalhe: aReceber.length ? `${brl(aReceber.reduce((a, l) => a + l.total, 0))} em pedidos` : "Nada pendente",
                },
                { rotulo: "Pendências fiscais", valor: num(comPendencia), detalhe: comPendencia ? "Notas, chaves ou anexos faltando" : "Tudo documentado" },
                { rotulo: "Total comprado", valor: brl(validas.reduce((a, l) => a + l.total, 0)), detalhe: "Desde o começo" },
              ]}
            />
            <Cartao className="cartao-lista">
              <div className="barra">
                <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar por fornecedor, peça, NF ou lote…" />
                <div className="mes-filtro">
                  <Selecao
                    valor={mes}
                    aoMudar={(m) => trocarQuery("mes", m || undefined)}
                    vazio="Todos os meses"
                    opcoes={meses.map((m) => ({ valor: m, rotulo: nomeDoMes(m) }))}
                  />
                </div>
                <Filtros ativo={filtro} aoMudar={(id) => trocarQuery("filtro", id === "todas" ? undefined : id)} opcoes={filtros} />
              </div>
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Fornecedor</th>
                      <th>Itens</th>
                      <th>Documento</th>
                      <th>Situação</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((l) => {
                      const c = l.compra;
                      const pend = temPendencia(l);
                      return (
                        <tr key={c.id} className="clicavel" onClick={() => ir(`/compras/${c.id}`)}>
                          <td className="sem-quebra">{data(c.data)}</td>
                          <td>
                            <a className="celula-titulo link-linha" href={`#/compras/${c.id}`} onClick={(e) => e.stopPropagation()}>
                              {l.fornecedor?.nome ?? "Fornecedor não informado"}
                            </a>
                            <div className="sub">{l.lote ? `Lote ${l.lote.codigo}` : c.legado ? "App antigo" : "Sem lote"}</div>
                          </td>
                          <td className="celula-itens">
                            {l.itens.slice(0, 2).map((i) => (
                              <div key={i.id}>
                                <span className="fraco">{num(i.quantidade)}×</span> {nomes.get(i.componenteId) ?? i.componenteId}
                              </div>
                            ))}
                            {l.itens.length > 2 && <div className="sub">+ {plural(l.itens.length - 2, "item", "itens")}</div>}
                          </td>
                          <td>
                            <div className="doc-celula">
                              <span>
                                {ROTULOS.documento[c.documentoTipo]}
                                {c.numeroNF && <span className="mono"> {c.numeroNF}</span>}
                              </span>
                              {pend && <Led cor="ambar" titulo="Pendência fiscal" />}
                              {l.anexos > 0 && <Paperclip className="clipe" aria-label={plural(l.anexos, "anexo", "anexos")} />}
                            </div>
                            {c.compradoEm === "cpf" && <div className="sub">no CPF</div>}
                            {c.legado && <div className="sub">importada do app antigo</div>}
                          </td>
                          <td>
                            <Status cor={COR_COMPRA[c.status]}>{ROTULOS.statusCompra[c.status]}</Status>
                          </td>
                          <td className="num">{l.total ? brl(l.total) : <span className="fraco">sem valor</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {visiveis.length > 1 && (
                    <tfoot>
                      <tr>
                        <td colSpan={5}>
                          {plural(visiveis.length, "compra", "compras")}
                          {mes ? ` em ${nomeDoMes(mes)}` : ""}
                        </td>
                        <td className="num">{brl(visiveis.filter((l) => l.compra.status !== "cancelada").reduce((a, l) => a + l.total, 0))}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
                {visiveis.length === 0 && <p className="lista-vazia">Nenhuma compra com esse filtro.</p>}
              </div>
            </Cartao>
          </>
        )}
      </div>
    </>
  );
}

// ---------- Editor ----------

interface LinhaItem {
  chave: string;
  id?: string;
  componenteId: string;
  quantidade: number;
  valorTotal: number;
  qtdRecebida: number;
  nota?: { descricao: string; codigo: string; quantidade: number; unidade: string; ncm: string };
}

const ETAPAS: { valor: StatusCompra; rotulo: string; detalhe: string }[] = [
  { valor: "rascunho", rotulo: "Rascunho", detalhe: "Ainda montando a compra." },
  { valor: "pedido", rotulo: "Pedido feito", detalhe: "Conta como “a receber” nos lotes." },
  { valor: "em_transito", rotulo: "Em trânsito", detalhe: "Enviado pelo fornecedor." },
  { valor: "recebida_parcial", rotulo: "Recebida em parte", detalhe: "Entra no estoque só o que chegou." },
  { valor: "recebida", rotulo: "Recebida", detalhe: "Tudo entra no estoque." },
  { valor: "cancelada", rotulo: "Cancelada", detalhe: "Não conta em nada." },
];

const DOCUMENTOS: { valor: TipoDocumento; rotulo: string }[] = [
  { valor: "nfe", rotulo: "NF-e" },
  { valor: "nfce", rotulo: "NFC-e" },
  { valor: "importacao", rotulo: "Importação" },
  { valor: "recibo", rotulo: "Recibo" },
  { valor: "sem_documento", rotulo: "Sem documento" },
];

let contador = 0;
const novaChave = () => `l${++contador}`;

// Liga um item da nota a um componente: primeiro pelo que já foi ligado antes, depois pelo nome.
function sugerirComponente(base: BaseDados, mapa: Record<string, string>, cnpj: string, item: NotaImportada["itens"][number]): string {
  const lembrado = mapa[`${cnpj}:${item.codigo}`];
  if (lembrado && base.componentes.some((c) => c.id === lembrado)) return lembrado;
  const palavras = (s: string) => new Set(normalizar(s).split(/[^a-z0-9]+/).filter((p) => p.length >= 3));
  const daNota = palavras(`${item.descricao} ${item.codigo}`);
  // Precisa de pelo menos duas palavras em comum ("8SW" sozinho casaria com a PCB, a caixa e a embalagem)
  // e de um vencedor claro; na dúvida, deixa em branco para a pessoa escolher.
  const notas = base.componentes
    .filter((x) => x.ativo)
    .map((c) => {
      const doComp = palavras(`${c.nome} ${c.variante ?? ""} ${c.sku ?? ""}`);
      let comuns = 0;
      for (const p of doComp) if (daNota.has(p)) comuns++;
      return { id: c.id, comuns, nota: doComp.size ? comuns / doComp.size + comuns * 0.1 : 0 };
    })
    .filter((x) => x.comuns >= 2)
    .sort((a, b) => b.nota - a.nota);
  if (!notas.length || (notas[1] && notas[1].nota === notas[0].nota)) return "";
  return notas[0].id;
}

function EditorCompra({ base, id }: { base: BaseDados; id?: string }) {
  const existente = id ? base.compras.find((c) => c.id === id) : undefined;
  const loteInicial = useLocal().query.get("lote") ?? undefined;
  const [importada] = useState(() => (!id ? notaPendente : null));
  useEffect(() => {
    notaPendente = null;
  }, []);

  const inicial = useMemo((): { compra: CompraEditavel; itens: LinhaItem[]; fornecedorNovo?: NotaImportada["emitente"] } => {
    if (existente) {
      return {
        compra: { ...existente },
        itens: base.compraItens
          .filter((i) => i.compraId === existente.id)
          .map((i) => ({ chave: i.id, id: i.id, componenteId: i.componenteId, quantidade: i.quantidade, valorTotal: i.valorTotal, qtdRecebida: i.qtdRecebida })),
      };
    }
    if (importada) {
      const n = importada.nota;
      const fornecedor = base.fornecedores.find((f) => soDocumento(f.documento) && soDocumento(f.documento) === n.emitente.documento);
      const mapa = base.mapaNFe ?? {};
      return {
        compra: {
          fornecedorId: fornecedor?.id,
          data: n.emissao,
          recebidaEm: diaParaIso(hoje()),
          status: "recebida",
          documentoTipo: "nfe",
          numeroNF: n.numero,
          serieNF: n.serie,
          chaveNFe: n.chave || undefined,
          compradoEm: n.destinatario.documento.length === 11 ? "cpf" : "cnpj",
          frete: n.totais.frete,
          impostos: Math.round((n.totais.ipi + n.totais.icmsSt + n.totais.ii) * 100) / 100,
          outrasDespesas: Math.round((n.totais.outras + n.totais.seguro) * 100) / 100,
          moeda: "BRL",
        },
        itens: n.itens.map((i) => ({
          chave: novaChave(),
          componenteId: sugerirComponente(base, mapa, n.emitente.documento, i),
          quantidade: i.quantidade,
          valorTotal: i.valorLiquido,
          qtdRecebida: i.quantidade,
          nota: { descricao: i.descricao, codigo: i.codigo, quantidade: i.quantidade, unidade: i.unidade, ncm: i.ncm },
        })),
        fornecedorNovo: fornecedor ? undefined : n.emitente,
      };
    }
    return {
      compra: { data: diaParaIso(hoje()), status: "pedido", documentoTipo: "nfe", compradoEm: "cnpj", frete: 0, impostos: 0, outrasDespesas: 0, moeda: "BRL", loteId: loteInicial },
      itens: [{ chave: novaChave(), componenteId: "", quantidade: 1, valorTotal: 0, qtdRecebida: 0 }],
    };
    // Calculado só na abertura do editor; depois o formulário é a fonte.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const form = useFormulario<CompraEditavel>(inicial.compra);
  const { valores: v, mudar } = form;
  const [itens, setItens] = useState<LinhaItem[]>(inicial.itens);
  const [fornecedorNovo, setFornecedorNovo] = useState(inicial.fornecedorNovo);
  const [pendentes, setPendentes] = useState<File[]>(importada ? [importada.arquivo] : []);
  const [criando, setCriando] = useState<{ tipo: "fornecedor" } | { tipo: "componente"; linha: number } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const anexos = useAnexos("compra", existente?.id);
  const entradaAnexo = useRef<HTMLInputElement>(null);
  const { confirmar, avisar } = useFeedback();
  const executar = useExecutar();
  useProtegerSaida(form.sujo || (!!importada && !salvando));

  const custos = custosDeEntrada(
    v,
    itens.map((i) => ({ id: i.chave, quantidade: i.quantidade, valorTotal: i.valorTotal })),
  );
  const produtos = itens.reduce((a, i) => a + (i.valorTotal || 0), 0);
  const total = produtos + (v.frete || 0) + (v.impostos || 0) + (v.outrasDespesas || 0);
  const temNota = v.documentoTipo === "nfe" || v.documentoTipo === "nfce";
  const chaveDigitos = soDocumento(v.chaveNFe);
  const erroChave = chaveDigitos.length > 0 && !chaveNFeValida(chaveDigitos) && "Chave inválida: são 44 dígitos e o último confere os outros.";
  const recebe = v.status === "recebida" || v.status === "recebida_parcial";
  const pecasEntrando = itens.reduce((a, i) => {
    const c = base.componentes.find((x) => x.id === i.componenteId);
    if (!c?.controlaEstoque || existente?.legado) return a;
    return a + (v.status === "recebida" ? i.quantidade : v.status === "recebida_parcial" ? Math.min(i.qtdRecebida, i.quantidade) : 0);
  }, 0);

  if (id && !existente) return <SemDados titulo="Compra não encontrada" icone={ShoppingCart} novo={{ rotulo: "Voltar às compras", href: "#/compras" }} />;

  const fornecedor = base.fornecedores.find((f) => f.id === v.fornecedorId);
  const opcoesFornecedor = base.fornecedores
    .filter((f) => f.ativo || f.id === v.fornecedorId)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((f) => ({ valor: f.id, rotulo: f.nome, detalhe: soDocumento(f.documento) ? formatarDocumento(f.documento) : ROTULOS.tipoFornecedor[f.tipo] }));
  const opcoesPecas = base.componentes
    .filter((c) => c.ativo || itens.some((i) => i.componenteId === c.id))
    .sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: c.variante, grupo: c.categoria }));
  const lotesAbertos = base.lotes
    .filter((l) => (l.status !== "concluido" && l.status !== "cancelado") || l.id === v.loteId)
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .map((l) => ({ valor: l.id, rotulo: `${l.codigo}${l.nome ? ` — ${l.nome}` : ""}` }));

  const mudarItem = (i: number, parcial: Partial<LinhaItem>) => {
    setItens((l) => l.map((x, j) => (j === i ? { ...x, ...parcial } : x)));
    form.setSujo(true);
  };

  const voltar = async () => {
    if ((form.sujo || importada) && !(await confirmar({ titulo: "Descartar esta compra?", texto: "O que você preencheu ainda não foi salvo.", confirmar: "Descartar", perigo: true }))) return;
    ir("/compras");
  };

  const salvar = async () => {
    form.setTentou(true);
    const validos = itens.filter((i) => i.componenteId);
    if (!validos.length) return avisar("Inclua pelo menos uma peça.", true);
    if (itens.some((i) => !i.componenteId && (i.valorTotal || i.nota))) return avisar("Escolha a peça de cada item (ou remova a linha).", true);
    if (validos.some((i) => !(i.quantidade > 0))) return avisar("Cada item precisa de uma quantidade.", true);
    if (erroChave) return avisar("Confira a chave de acesso da NF-e.", true);
    setSalvando(true);
    const ok = await executar(async () => {
      let fornecedorId = v.fornecedorId;
      if (!fornecedorId && fornecedorNovo) {
        fornecedorId = await salvarFornecedor({
          nome: fornecedorNovo.fantasia || fornecedorNovo.nome,
          documento: fornecedorNovo.documento,
          tipo: "nacional",
          pais: "Brasil",
          obs: [fornecedorNovo.nome, fornecedorNovo.municipio && `${fornecedorNovo.municipio}/${fornecedorNovo.uf}`].filter(Boolean).join(" · "),
          ativo: true,
        });
      }
      const compraId = await salvarCompra(
        {
          ...v,
          fornecedorId,
          numeroNF: v.numeroNF?.trim() || undefined,
          serieNF: v.serieNF?.trim() || undefined,
          chaveNFe: chaveDigitos || undefined,
          recebidaEm: recebe ? (v.recebidaEm ?? diaParaIso(hoje())) : undefined,
        },
        validos.map((i): Omit<CompraItem, "id" | "compraId"> & { id?: string } => ({ id: i.id, componenteId: i.componenteId, quantidade: i.quantidade, valorTotal: i.valorTotal || 0, qtdRecebida: i.qtdRecebida })),
      );
      for (const f of pendentes) await anexarArquivo("compra", compraId, f);
      if (importada) {
        const cnpj = importada.nota.emitente.documento;
        const mapa = { ...(base.mapaNFe ?? {}) };
        for (const i of validos) if (i.nota?.codigo) mapa[`${cnpj}:${i.nota.codigo}`] = i.componenteId;
        await salvarConfig("mapaNFe", mapa);
      }
      return compraId;
    });
    setSalvando(false);
    if (!ok) return;
    form.setSujo(false);
    avisar(recebe && pecasEntrando ? `Compra salva. ${plural(pecasEntrando, "peça entrou", "peças entraram")} no estoque.` : "Compra salva.");
    ir("/compras");
  };

  const excluir = async () => {
    if (!(await confirmar({ titulo: "Excluir esta compra?", texto: "A compra, os anexos e as entradas no estoque que ela gerou serão apagados.", confirmar: "Excluir", perigo: true }))) return;
    if (await executar(() => excluirCompra(existente!.id), "Compra excluída.")) ir("/compras");
  };

  const notaTotal = importada?.nota.totais.nota;
  const diferencaNota = notaTotal != null ? Math.round((total - notaTotal) * 100) / 100 : 0;

  return (
    <>
      <Cabecalho
        sobretitulo="Compras"
        titulo={existente ? `Compra${fornecedor ? ` de ${fornecedor.nome}` : ""}` : importada ? "Nova compra pela NF-e" : "Nova compra"}
        descricao={
          existente
            ? `${data(existente.data)}${existente.numeroNF ? ` · NF ${existente.numeroNF}` : ""}${existente.legado ? " · importada do app antigo" : ""}`
            : importada
              ? `NF ${importada.nota.numero} de ${importada.nota.emitente.fantasia || importada.nota.emitente.nome}. Confira as peças e salve.`
              : "Preencha o fornecedor, a nota e as peças. Frete e impostos entram no custo das peças."
        }
        acoes={
          <>
            <button className="botao fantasma" onClick={voltar}>
              <ArrowLeft aria-hidden="true" />
              Compras
            </button>
            {existente && (
              <button className="botao perigo" onClick={excluir}>
                Excluir
              </button>
            )}
            <button className="botao primario" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar compra"}
            </button>
          </>
        }
      />

      {existente?.legado && (
        <div style={{ marginBottom: 16 }}>
          <Aviso titulo="Compra importada do app antigo">
            As peças dela já estão no saldo inicial do estoque, então ela não gera entrada. Complete fornecedor e documento se tiver a nota.
          </Aviso>
        </div>
      )}

      <div className="editor">
        <div className="pilha">
          <Cartao titulo="Fornecedor e documento fiscal">
            <div className="formulario">
              <Campo rotulo="Fornecedor" htmlFor="cp-forn">
                {fornecedorNovo && !v.fornecedorId ? (
                  <div className="fornecedor-novo">
                    <div>
                      <strong>{fornecedorNovo.fantasia || fornecedorNovo.nome}</strong>
                      <div className="sub">
                        {formatarDocumento(fornecedorNovo.documento)} · novo, será cadastrado ao salvar
                      </div>
                    </div>
                    <button type="button" className="botao pequeno fantasma" onClick={() => setFornecedorNovo(undefined)}>
                      Escolher outro
                    </button>
                  </div>
                ) : (
                  <Escolha
                    id="cp-forn"
                    valor={v.fornecedorId}
                    aoMudar={(x) => mudar("fornecedorId", x)}
                    opcoes={opcoesFornecedor}
                    placeholder="De quem você comprou?"
                    aoCriar={() => setCriando({ tipo: "fornecedor" })}
                    rotuloCriar="Cadastrar"
                  />
                )}
              </Campo>
              <Campo rotulo="Data da compra" htmlFor="cp-data">
                <Data id="cp-data" valor={isoParaDia(v.data)} aoMudar={(x) => x && mudar("data", diaParaIso(x))} />
              </Campo>
              <Campo rotulo="Documento fiscal" inteiro>
                <Segmentado rotulo="Documento" valor={v.documentoTipo} aoMudar={(x) => mudar("documentoTipo", x)} opcoes={DOCUMENTOS} />
              </Campo>
              {(temNota || v.documentoTipo === "importacao") && (
                <>
                  <Campo rotulo={v.documentoTipo === "importacao" ? "Nº da declaração ou do rastreio" : "Número da nota"} htmlFor="cp-num">
                    <Texto id="cp-num" className="mono" valor={v.numeroNF} aoMudar={(x) => mudar("numeroNF", x)} />
                  </Campo>
                  {temNota && (
                    <Campo rotulo="Série" opcional htmlFor="cp-serie">
                      <Texto id="cp-serie" className="mono" valor={v.serieNF} aoMudar={(x) => mudar("serieNF", x)} />
                    </Campo>
                  )}
                </>
              )}
              {v.documentoTipo === "nfe" && (
                <Campo rotulo="Chave de acesso" inteiro erro={erroChave} dica="Os 44 dígitos impressos no DANFE. O contador usa para conferir a nota." htmlFor="cp-chave">
                  <Texto
                    id="cp-chave"
                    className="mono"
                    valor={v.chaveNFe}
                    aoMudar={(x) => mudar("chaveNFe", x)}
                    onBlur={() => mudar("chaveNFe", formatarChave(v.chaveNFe))}
                    placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000"
                  />
                </Campo>
              )}
              <Campo rotulo="Comprado no" inteiro>
                <Segmentado
                  rotulo="Comprado no"
                  valor={v.compradoEm}
                  aoMudar={(x) => mudar("compradoEm", x)}
                  opcoes={[
                    { valor: "cnpj", rotulo: "CNPJ da empresa" },
                    { valor: "cpf", rotulo: "CPF" },
                    { valor: "nao_informado", rotulo: "Não sei" },
                  ]}
                />
              </Campo>
              {v.compradoEm === "cpf" && (
                <div className="campo-inteiro">
                  <Aviso>Nota em nome da pessoa física. Pergunte ao contador se ela pode entrar como custo da empresa.</Aviso>
                </div>
              )}
            </div>
          </Cartao>

          <Cartao
            titulo="Peças"
            sub="Valor pago pelos produtos, já com desconto e sem frete. Frete e impostos vão no quadro abaixo."
            acoes={
              <button
                type="button"
                className="botao pequeno"
                onClick={() => {
                  setItens((l) => [...l, { chave: novaChave(), componenteId: "", quantidade: 1, valorTotal: 0, qtdRecebida: 0 }]);
                  form.setSujo(true);
                }}
              >
                <Plus aria-hidden="true" />
                Adicionar peça
              </button>
            }
          >
            <div className="tabela-wrap">
              <table className="tabela tabela-edicao">
                <thead>
                  <tr>
                    <th style={{ width: "40%" }}>Peça</th>
                    <th className="num col-qtd">Qtd</th>
                    {v.status === "recebida_parcial" && <th className="num col-qtd">Chegou</th>}
                    <th className="num" style={{ width: 150 }}>
                      Valor
                    </th>
                    <th className="num">Custo unit.</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i, idx) => {
                    const custo = custos.get(i.chave);
                    const comp = base.componentes.find((c) => c.id === i.componenteId);
                    return (
                      <tr key={i.chave}>
                        <td>
                          <Escolha
                            valor={i.componenteId}
                            aoMudar={(x) => mudarItem(idx, { componenteId: x })}
                            opcoes={opcoesPecas}
                            placeholder="Escolha a peça"
                            aoCriar={() => setCriando({ tipo: "componente", linha: idx })}
                            rotuloCriar="Cadastrar"
                            invalido={form.tentou && !i.componenteId}
                          />
                          {i.nota && (
                            <div className="sub item-nota" title={`Código ${i.nota.codigo} · NCM ${i.nota.ncm}`}>
                              Na nota: {i.nota.descricao} ({num(i.nota.quantidade)} {i.nota.unidade})
                            </div>
                          )}
                          {comp && !comp.controlaEstoque && <div className="sub">não entra no estoque</div>}
                        </td>
                        <td>
                          <Numero valor={i.quantidade} aoMudar={(x) => mudarItem(idx, { quantidade: x ?? 0 })} aria-label="Quantidade" />
                        </td>
                        {v.status === "recebida_parcial" && (
                          <td>
                            <Numero valor={i.qtdRecebida} aoMudar={(x) => mudarItem(idx, { qtdRecebida: x ?? 0 })} aria-label="Quantidade recebida" />
                          </td>
                        )}
                        <td>
                          <Moeda valor={i.valorTotal} aoMudar={(x) => mudarItem(idx, { valorTotal: x ?? 0 })} aria-label="Valor do item" />
                        </td>
                        <td className="num">
                          {custo && i.quantidade > 0 ? brlUnit(custo.custoUnitario) : <span className="fraco">—</span>}
                          {custo && custo.rateio > 0.005 && <div className="sub">+ {brl(custo.rateio)} de rateio</div>}
                        </td>
                        <td className="acao-linha">
                          <button
                            type="button"
                            className="botao fantasma icone"
                            aria-label="Remover item"
                            onClick={() => {
                              setItens((l) => l.filter((_, j) => j !== idx));
                              form.setSujo(true);
                            }}
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {itens.length === 0 && <p className="lista-vazia">Nenhuma peça. Use “Adicionar peça”.</p>}
            </div>
          </Cartao>

          <Cartao titulo="Frete, impostos e outras despesas" sub="Divididos entre as peças na proporção do valor de cada uma: viram parte do custo no estoque.">
            <div className="formulario tres-colunas">
              <Campo rotulo="Frete" htmlFor="cp-frete">
                <Moeda id="cp-frete" valor={v.frete} aoMudar={(x) => mudar("frete", x ?? 0)} />
              </Campo>
              <Campo rotulo="Impostos" htmlFor="cp-imp" dica="Importação, IPI, ICMS-ST, DIFAL.">
                <Moeda id="cp-imp" valor={v.impostos} aoMudar={(x) => mudar("impostos", x ?? 0)} />
              </Campo>
              <Campo rotulo="Outras despesas" htmlFor="cp-outras" dica="Seguro, taxas, despachante.">
                <Moeda id="cp-outras" valor={v.outrasDespesas} aoMudar={(x) => mudar("outrasDespesas", x ?? 0)} />
              </Campo>
            </div>
          </Cartao>

          <Cartao
            icone={Paperclip}
            titulo="Nota e comprovantes"
            sub="PDF do DANFE, XML, recibo ou print do pedido. Vão junto no pacote do contador."
            acoes={
              <button type="button" className="botao pequeno" onClick={() => entradaAnexo.current?.click()}>
                <Upload aria-hidden="true" />
                Anexar
              </button>
            }
          >
            <input
              ref={entradaAnexo}
              type="file"
              multiple
              hidden
              accept=".pdf,.xml,image/*,application/pdf,text/xml"
              onChange={async (e) => {
                const arquivos = [...(e.target.files ?? [])];
                e.target.value = "";
                if (existente) {
                  for (const f of arquivos) await anexarArquivo("compra", existente.id, f);
                  if (arquivos.length) avisar(plural(arquivos.length, "arquivo anexado", "arquivos anexados") + ".");
                } else {
                  setPendentes((p) => [...p, ...arquivos]);
                  form.setSujo(true);
                }
              }}
            />
            <ul className="anexos">
              {(anexos ?? []).map((a) => (
                <li key={a.id}>
                  <FileText aria-hidden="true" />
                  <button
                    type="button"
                    className="anexo-nome"
                    onClick={() => {
                      const url = URL.createObjectURL(a.conteudo);
                      window.open(url, "_blank");
                      setTimeout(() => URL.revokeObjectURL(url), 60000);
                    }}
                  >
                    {a.nome}
                  </button>
                  <span className="fraco">{tamanho(a.tamanho)}</span>
                  <button
                    type="button"
                    className="botao fantasma icone pequeno"
                    aria-label={`Remover ${a.nome}`}
                    onClick={async () => {
                      if (await confirmar({ titulo: "Remover anexo?", texto: a.nome, confirmar: "Remover", perigo: true })) await removerAnexo(a.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </li>
              ))}
              {pendentes.map((f, i) => (
                <li key={`p${i}`}>
                  <FileText aria-hidden="true" />
                  <span className="anexo-nome">{f.name}</span>
                  <span className="fraco">anexa ao salvar</span>
                  <button type="button" className="botao fantasma icone pequeno" aria-label={`Remover ${f.name}`} onClick={() => setPendentes((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {!anexos?.length && !pendentes.length && <p className="fraco" style={{ margin: 0, fontSize: 13 }}>Nenhum arquivo anexado.</p>}
          </Cartao>

          <Cartao titulo="Observações">
            <AreaTexto valor={v.obs} aoMudar={(x) => mudar("obs", x)} placeholder="Ex.: pedido AliExpress 8123…, rastreio, combinado com o vendedor" />
          </Cartao>
        </div>

        <aside className="editor-lado pilha">
          <Cartao titulo="Situação">
            <div className="etapas" role="radiogroup" aria-label="Situação da compra">
              {ETAPAS.map((e) => (
                <button
                  key={e.valor}
                  type="button"
                  role="radio"
                  aria-checked={v.status === e.valor}
                  className="etapa"
                  onClick={() => {
                    mudar("status", e.valor);
                    if ((e.valor === "recebida" || e.valor === "recebida_parcial") && !v.recebidaEm) mudar("recebidaEm", diaParaIso(hoje()));
                  }}
                >
                  <Led cor={v.status === e.valor ? COR_COMPRA[e.valor] : "apagado"} />
                  <span>
                    <strong>{e.rotulo}</strong>
                    <span>{e.detalhe}</span>
                  </span>
                </button>
              ))}
            </div>
            {recebe && (
              <div className="formulario uma-coluna" style={{ marginTop: 16 }}>
                <Campo rotulo="Data em que chegou" htmlFor="cp-receb" dica="A data da entrada no estoque.">
                  <Data id="cp-receb" valor={isoParaDia(v.recebidaEm ?? v.data)} aoMudar={(x) => x && mudar("recebidaEm", diaParaIso(x))} />
                </Campo>
              </div>
            )}
            <div className="formulario uma-coluna" style={{ marginTop: 16 }}>
              <Campo rotulo="Lote" opcional htmlFor="cp-lote" dica="Para saber quanto cada lote gastou.">
                <Selecao id="cp-lote" valor={v.loteId ?? ""} aoMudar={(x) => mudar("loteId", x || undefined)} vazio="Sem lote" opcoes={lotesAbertos} />
              </Campo>
            </div>
          </Cartao>

          <Cartao titulo="Total">
            <dl className="resumo">
              <div>
                <dt>Peças</dt>
                <dd>{brl(produtos)}</dd>
              </div>
              <div>
                <dt>Frete</dt>
                <dd>{brl(v.frete)}</dd>
              </div>
              <div>
                <dt>Impostos</dt>
                <dd>{brl(v.impostos)}</dd>
              </div>
              <div>
                <dt>Outras despesas</dt>
                <dd>{brl(v.outrasDespesas)}</dd>
              </div>
              <div className="resumo-total">
                <dt>Total</dt>
                <dd>{brl(total)}</dd>
              </div>
            </dl>
            {notaTotal != null && (
              <p className={`nota ${Math.abs(diferencaNota) > 0.01 ? "nota-alerta" : ""}`}>
                {Math.abs(diferencaNota) > 0.01 ? `Total da nota: ${brl(notaTotal)} (diferença de ${brl(diferencaNota)}). Confira descontos e impostos.` : `Confere com o total da nota (${brl(notaTotal)}).`}
              </p>
            )}
            <p className="nota">
              {existente?.legado
                ? "Compra do app antigo: não gera entrada no estoque."
                : recebe
                  ? `Ao salvar, ${plural(pecasEntrando, "peça entra", "peças entram")} no estoque com o custo unitário calculado.`
                  : v.status === "cancelada"
                    ? "Cancelada: não entra no estoque nem nos relatórios."
                    : "Entra no estoque quando você marcar como recebida."}
            </p>
            {existente && STATUS_EM_ABERTO.includes(existente.status) && (
              <p className="nota">
                Falta chegar:{" "}
                {plural(
                  base.compraItens.filter((i) => i.compraId === existente.id).reduce((a, i) => a + quantidadeAReceber(existente, i), 0),
                  "peça",
                  "peças",
                )}
                .
              </p>
            )}
          </Cartao>
        </aside>
      </div>

      {criando?.tipo === "fornecedor" && (
        <EditorFornecedor
          base={base}
          aoFechar={() => setCriando(null)}
          aoCriar={(novo) => {
            mudar("fornecedorId", novo);
            setFornecedorNovo(undefined);
            setCriando(null);
          }}
        />
      )}
      {criando?.tipo === "componente" && (
        <EditorComponente
          base={base}
          aoFechar={() => setCriando(null)}
          aoCriar={(novo) => {
            mudarItem(criando.linha, { componenteId: novo });
            setCriando(null);
          }}
        />
      )}
    </>
  );
}

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
