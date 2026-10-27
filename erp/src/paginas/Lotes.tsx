import { ArrowLeft, Check, CirclePlay, Layers, PackageCheck, Pencil, Plus, ShoppingCart, Trash2, Undo2, Wrench, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  excluirApontamento,
  excluirCustoFabricacao,
  excluirLote,
  gerarPedidos,
  idCustoDoApontamento,
  mudarStatusDoLote,
  salvarApontamento,
  salvarCustoFabricacao,
  salvarLote,
  type LinhaPedido,
} from "../data/acoes";
import { quantidadeAReceber, totalDaCompra } from "../data/compras";
import { useBase, useConfigProducao } from "../data/consultas";
import { calcularSaldos } from "../data/estoque";
import { anoLocal, brl, brlUnit, data, diaParaIso, hoje, isoParaDia, num, pct, plural, ROTULOS } from "../data/formato";
import { composicaoDoItem, movimentosDeConsumo, necessidadesDoLote, proximoCodigoDeLote } from "../data/lotes";
import { custosDosLotes, mapaPorId, type BaseDados } from "../data/relatorios";
import type { Apontamento, CustoFabricacao, Lote, StatusLote, TipoCustoFabricacao } from "../data/tipos";
import { Aviso, Cabecalho, Cartao, Faixa, Led, Status, Tag, useFeedback } from "../ui/base";
import { AreaTexto, Campo, Data, Filtros, Moeda, Numero, Selecao, Texto, useFormulario } from "../ui/form";
import { Abas, Gaveta, useExecutar } from "../ui/gaveta";
import { IconePedal } from "../ui/icones";
import { ir, trocarQuery, useLocal } from "../ui/rota";
import { COR_LOTE, SemDados } from "./comum";

export function Lotes() {
  const local = useLocal();
  const base = useBase();
  if (!base) return null;
  const id = local.partes[0];
  if (id && id !== "novo") return <DetalheLote key={id} base={base} id={id} aba={local.partes[1] ?? "geral"} />;
  return (
    <>
      <ListaLotes base={base} />
      {id === "novo" && <EditorLote base={base} aoFechar={() => ir("/lotes")} />}
    </>
  );
}

const ATIVO = (s: StatusLote) => s !== "concluido" && s !== "cancelado";

function ListaLotes({ base }: { base: BaseDados }) {
  const local = useLocal();
  const filtro = local.query.get("filtro") ?? "andamento";
  const custos = useMemo(() => custosDosLotes(base), [base]);
  const produtos = mapaPorId(base.produtos);
  const lotes = [...base.lotes].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  const ano = String(new Date().getFullYear());
  const ativos = lotes.filter((l) => ATIVO(l.status));
  const visiveis = lotes.filter((l) => (filtro === "andamento" ? ATIVO(l.status) : filtro === "concluidos" ? l.status === "concluido" : filtro === "cancelados" ? l.status === "cancelado" : true));
  const doAno = base.apontamentos.filter((a) => anoLocal(a.data) === ano);
  const bonsAno = doAno.reduce((a, x) => a + x.qtdBoa, 0);
  const comCusto = [...custos.values()].filter((c) => c.porPedal != null);
  const mediaReal = comCusto.length ? comCusto.reduce((a, c) => a + c.total, 0) / comCusto.reduce((a, c) => a + c.pedaisBons, 0) : null;

  return (
    <>
      <Cabecalho
        sobretitulo="Operação"
        titulo="Lotes de produção"
        descricao="Cada lote reúne os pedais montados juntos: o que precisa comprar, o que foi produzido e quanto cada pedal custou de verdade."
        acoes={
          <button className="botao primario" onClick={() => ir("/lotes/novo")}>
            <Plus aria-hidden="true" />
            Novo lote
          </button>
        }
      />
      <div className="pilha">
        {lotes.length === 0 ? (
          <SemDados titulo="Nenhum lote ainda" icone={Layers} texto="Crie um lote com quantos pedais de cada modelo você vai montar. O app calcula as peças que faltam e gera os pedidos." novo={{ rotulo: "Novo lote", href: "#/lotes/novo" }} />
        ) : (
          <>
            <Faixa
              itens={[
                { rotulo: "Em andamento", valor: num(ativos.length), detalhe: plural(ativos.reduce((a, l) => a + base.loteItens.filter((i) => i.loteId === l.id).reduce((s, i) => s + i.qtdPlanejada, 0), 0), "pedal planejado", "pedais planejados") },
                { rotulo: `Produzidos em ${ano}`, valor: num(bonsAno), detalhe: `${plural(doAno.reduce((a, x) => a + x.qtdRefugo, 0), "refugado", "refugados")}` },
                { rotulo: "Concluídos", valor: num(lotes.filter((l) => l.status === "concluido").length), detalhe: "No histórico" },
                { rotulo: "Custo real médio", valor: mediaReal != null ? brl(mediaReal) : "—", detalhe: mediaReal != null ? "Por pedal bom, lotes apontados" : "Registre a produção dos lotes" },
              ]}
            />
            <Cartao className="cartao-lista">
              <div className="barra">
                <Filtros
                  ativo={filtro}
                  aoMudar={(id) => trocarQuery("filtro", id === "andamento" ? undefined : id)}
                  opcoes={[
                    { id: "andamento", rotulo: "Em andamento", contagem: ativos.length },
                    { id: "concluidos", rotulo: "Concluídos" },
                    { id: "cancelados", rotulo: "Cancelados" },
                    { id: "todos", rotulo: "Todos", contagem: lotes.length },
                  ]}
                />
              </div>
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Lote</th>
                      <th>Situação</th>
                      <th>Pedais</th>
                      <th>Início</th>
                      <th>Fim</th>
                      <th className="num">Compras</th>
                      <th className="num">Custo real / pedal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((l) => {
                      const itens = base.loteItens.filter((i) => i.loteId === l.id);
                      const compras = base.compras.filter((c) => c.loteId === l.id && c.status !== "cancelada");
                      const gasto = compras.reduce((a, c) => a + totalDaCompra(c, base.compraItens.filter((i) => i.compraId === c.id)), 0);
                      const custo = custos.get(l.id);
                      return (
                        <tr key={l.id} className="clicavel" onClick={() => ir(`/lotes/${l.id}`)}>
                          <td>
                            <a href={`#/lotes/${l.id}`} onClick={(e) => e.stopPropagation()} className="link-linha">
                              <Tag codigo>{l.codigo}</Tag>
                            </a>
                          </td>
                          <td>
                            <Status cor={COR_LOTE[l.status]}>{ROTULOS.statusLote[l.status]}</Status>
                          </td>
                          <td className="celula-itens">
                            {itens.map((i) => (
                              <div key={i.id}>
                                <span className="fraco">{i.qtdProduzida != null ? `${num(i.qtdProduzida)}/${num(i.qtdPlanejada)}` : `${num(i.qtdPlanejada)}×`}</span> {produtos.get(i.produtoId)?.nome ?? i.produtoId}
                              </div>
                            ))}
                          </td>
                          <td className="sem-quebra">{data(l.criadoEm)}</td>
                          <td className="sem-quebra">{data(l.concluidoEm)}</td>
                          <td className="num">
                            {num(compras.length)}
                            {gasto > 0 && <div className="sub">{brl(gasto)}</div>}
                          </td>
                          <td className="num">{custo?.porPedal != null ? brl(custo.porPedal) : <span className="fraco">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {visiveis.length === 0 && <p className="lista-vazia">Nenhum lote com esse filtro.</p>}
              </div>
            </Cartao>
          </>
        )}
      </div>
    </>
  );
}

// ---------- Criar / editar lote ----------

interface LinhaPedais {
  chave: string;
  produtoId: string;
  qtdPlanejada: number | null;
}

// Espera os parâmetros de produção carregarem, para a margem padrão valer no lote novo.
function EditorLote(props: { base: BaseDados; lote?: Lote; aoFechar: () => void }) {
  const config = useConfigProducao();
  return config ? <FormularioLote {...props} margemPadrao={config.margemPadrao} /> : null;
}

function FormularioLote({ base, lote, aoFechar, margemPadrao }: { base: BaseDados; lote?: Lote; aoFechar: () => void; margemPadrao: number }) {
  const form = useFormulario({
    codigo: lote?.codigo ?? proximoCodigoDeLote(base.lotes.map((l) => l.codigo)),
    nome: lote?.nome ?? "",
    margemSobra: (lote?.margemSobra ?? margemPadrao) as number | null,
    obs: lote?.obs ?? "",
  });
  const { valores: v, mudar } = form;
  const ativos = base.produtos.filter((p) => p.ativo);
  const [linhas, setLinhas] = useState<LinhaPedais[]>(() =>
    lote
      ? base.loteItens.filter((i) => i.loteId === lote.id && i.qtdPlanejada > 0).map((i) => ({ chave: i.id, produtoId: i.produtoId, qtdPlanejada: i.qtdPlanejada }))
      : ativos.map((p) => ({ chave: p.id, produtoId: p.id, qtdPlanejada: null })),
  );
  const { avisar } = useFeedback();
  const total = linhas.reduce((a, l) => a + (l.qtdPlanejada ?? 0), 0);

  const salvar = async () => {
    form.setTentou(true);
    if (!v.codigo.trim()) return;
    if (!total) return avisar("Informe quantos pedais de pelo menos um modelo.", true);
    const nomeAuto = linhas
      .filter((l) => l.qtdPlanejada)
      .map((l) => `${l.qtdPlanejada}× ${base.produtos.find((p) => p.id === l.produtoId)?.nome ?? ""}`)
      .join(", ");
    const id = await salvarLote(
      {
        ...(lote ?? { status: "planejado" as const }),
        codigo: v.codigo.trim(),
        nome: v.nome.trim() || nomeAuto,
        margemSobra: v.margemSobra ?? 0,
        obs: v.obs.trim() || undefined,
      },
      linhas.filter((l) => l.produtoId && l.qtdPlanejada).map((l) => ({ produtoId: l.produtoId, qtdPlanejada: l.qtdPlanejada! })),
    );
    avisar(lote ? "Lote atualizado." : `Lote ${v.codigo} criado. Confira as peças que faltam.`);
    if (lote) aoFechar();
    else ir(`/lotes/${id}`);
  };

  const opcoesProdutos = base.produtos.filter((p) => p.ativo || linhas.some((l) => l.produtoId === p.id)).map((p) => ({ valor: p.id, rotulo: p.nome }));

  return (
    <Gaveta
      titulo={lote ? `Editar lote ${lote.codigo}` : "Novo lote"}
      sub="Quantos pedais de cada modelo vão ser montados juntos."
      aoFechar={aoFechar}
      aoSalvar={salvar}
      rotuloSalvar={lote ? "Salvar" : "Criar lote"}
      sujo={form.sujo}
    >
      <div className="formulario">
        <Campo rotulo="Código" erro={form.tentou && !v.codigo.trim() && "Informe o código."} htmlFor="l-cod">
          <Texto id="l-cod" className="mono" valor={v.codigo} aoMudar={(x) => mudar("codigo", x)} />
        </Campo>
        <Campo rotulo="Margem de sobra" htmlFor="l-margem" dica="A mais nas peças por unidade, para perdas e defeitos.">
          <Numero id="l-margem" valor={v.margemSobra} aoMudar={(x) => mudar("margemSobra", x)} sufixo="%" />
        </Campo>
        <Campo rotulo="Descrição" inteiro opcional htmlFor="l-nome" dica="Em branco, vira a lista de pedais (ex.: 4× 8SW+, 4× NANO+).">
          <Texto id="l-nome" valor={v.nome} aoMudar={(x) => mudar("nome", x)} placeholder="Ex.: Lote de Natal" />
        </Campo>
      </div>
      <div className="gaveta-secao">
        <div className="secao-cabeca">
          <div className="legenda">Pedais</div>
          <button type="button" className="botao pequeno" onClick={() => setLinhas((l) => [...l, { chave: `n${Date.now()}`, produtoId: "", qtdPlanejada: null }])}>
            <Plus aria-hidden="true" />
            Modelo
          </button>
        </div>
        <div className="pedais-lote">
          {linhas.map((l, i) => {
            const p = base.produtos.find((x) => x.id === l.produtoId);
            return (
              <div key={l.chave} className="pedal-linha">
                {p?.imagem ? (
                  <img src={p.imagem} alt="" className="pedal-mini" />
                ) : (
                  <span className="pedal-mini vazia">
                    <IconePedal width={18} height={18} />
                  </span>
                )}
                <Selecao
                  valor={l.produtoId}
                  aoMudar={(x) => {
                    setLinhas((ls) => ls.map((y, j) => (j === i ? { ...y, produtoId: x } : y)));
                    form.setSujo(true);
                  }}
                  vazio="Escolha o modelo"
                  opcoes={opcoesProdutos}
                />
                <Numero
                  valor={l.qtdPlanejada}
                  aoMudar={(x) => {
                    setLinhas((ls) => ls.map((y, j) => (j === i ? { ...y, qtdPlanejada: x } : y)));
                    form.setSujo(true);
                  }}
                  sufixo="pedais"
                  placeholder="0"
                  aria-label="Quantidade de pedais"
                />
                <button type="button" className="botao fantasma icone" aria-label="Remover modelo" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
        <p className="nota">{plural(total, "pedal no lote", "pedais no lote")}.</p>
      </div>
      <div className="formulario uma-coluna" style={{ marginTop: 22 }}>
        <Campo rotulo="Observações" opcional htmlFor="l-obs">
          <AreaTexto id="l-obs" valor={v.obs} aoMudar={(x) => mudar("obs", x)} />
        </Campo>
      </div>
    </Gaveta>
  );
}

// ---------- Detalhe do lote ----------

const ETAPAS: StatusLote[] = ["planejado", "comprando", "em_producao", "concluido"];

function DetalheLote({ base, id, aba }: { base: BaseDados; id: string; aba: string }) {
  const lote = base.lotes.find((l) => l.id === id);
  const config = useConfigProducao();
  const [editando, setEditando] = useState(false);
  const { confirmar } = useFeedback();
  const executar = useExecutar();
  const custo = useMemo(() => custosDosLotes(base).get(id), [base, id]);
  if (!lote) return <SemDados titulo="Lote não encontrado" icone={Layers} novo={{ rotulo: "Voltar aos lotes", href: "#/lotes" }} />;

  const itens = base.loteItens.filter((i) => i.loteId === lote.id);
  const apontamentos = base.apontamentos.filter((a) => a.loteId === lote.id);
  const compras = base.compras.filter((c) => c.loteId === lote.id);
  const custos = base.custosFabricacao.filter((c) => c.loteId === lote.id);
  const planejados = itens.reduce((a, i) => a + i.qtdPlanejada, 0);
  const bons = apontamentos.reduce((a, x) => a + x.qtdBoa, 0);
  const gastoCompras = compras.filter((c) => c.status !== "cancelada").reduce((a, c) => a + totalDaCompra(c, base.compraItens.filter((i) => i.compraId === c.id)), 0);
  const ativo = ATIVO(lote.status);

  const mudarStatus = async (status: StatusLote, pergunta?: { titulo: string; texto: string; confirmar: string; perigo?: boolean }) => {
    if (pergunta && !(await confirmar(pergunta))) return;
    await executar(() => mudarStatusDoLote(lote.id, status), `Lote ${ROTULOS.statusLote[status].toLowerCase()}.`);
  };

  const acaoPrincipal =
    lote.status === "planejado" || lote.status === "comprando" ? (
      <button className="botao primario" onClick={() => ir(`/lotes/${lote.id}/producao`)}>
        <CirclePlay aria-hidden="true" />
        Registrar produção
      </button>
    ) : lote.status === "em_producao" ? (
      <button
        className="botao primario"
        onClick={() =>
          mudarStatus("concluido", {
            titulo: `Concluir o lote ${lote.codigo}?`,
            texto: `${plural(bons, "pedal bom registrado", "pedais bons registrados")} de ${num(planejados)} planejados. O custo real fica fechado com o que foi lançado até agora (dá para reabrir depois).`,
            confirmar: "Concluir lote",
          })
        }
      >
        <PackageCheck aria-hidden="true" />
        Concluir lote
      </button>
    ) : (
      <button className="botao" onClick={() => mudarStatus(apontamentos.length ? "em_producao" : "planejado")}>
        <Undo2 aria-hidden="true" />
        Reabrir lote
      </button>
    );

  return (
    <>
      <Cabecalho
        sobretitulo="Lotes"
        titulo={`Lote ${lote.codigo}`}
        descricao={lote.nome}
        meta={
          <>
            <Status cor={COR_LOTE[lote.status]}>{ROTULOS.statusLote[lote.status]}</Status>
            <Tag>Início {data(lote.criadoEm)}</Tag>
            {lote.concluidoEm && <Tag>Fim {data(lote.concluidoEm)}</Tag>}
            {lote.margemSobra > 0 && <Tag>{num(lote.margemSobra)}% de sobra</Tag>}
          </>
        }
        acoes={
          <>
            <a className="botao fantasma" href="#/lotes">
              <ArrowLeft aria-hidden="true" />
              Lotes
            </a>
            {ativo && (
              <button className="botao" onClick={() => setEditando(true)}>
                <Pencil aria-hidden="true" />
                Editar
              </button>
            )}
            {acaoPrincipal}
          </>
        }
      />

      <ol className="trilha" aria-label="Etapas do lote">
        {ETAPAS.map((e, i) => {
          const atual = ETAPAS.indexOf(lote.status);
          const estado = lote.status === "cancelado" ? "" : i < atual ? "feita" : i === atual ? "atual" : "";
          return (
            <li key={e} className={`trilha-etapa ${estado}`}>
              <span className="trilha-marca">{estado === "feita" ? <Check aria-hidden="true" /> : i + 1}</span>
              {ROTULOS.statusLote[e]}
            </li>
          );
        })}
        {lote.status === "cancelado" && (
          <li className="trilha-etapa cancelada">
            <span className="trilha-marca">
              <X aria-hidden="true" />
            </span>
            Cancelado
          </li>
        )}
      </ol>

      <Faixa
        itens={[
          { rotulo: "Pedais", valor: `${num(bons)} / ${num(planejados)}`, detalhe: "Bons / planejados" },
          { rotulo: "Compras do lote", valor: brl(gastoCompras), detalhe: plural(compras.filter((c) => c.status !== "cancelada").length, "compra", "compras") },
          { rotulo: "Custo real", valor: custo && custo.total > 0 ? brl(custo.total) : "—", detalhe: "Peças usadas + mão de obra + outros" },
          { rotulo: "Por pedal", valor: custo?.porPedal != null ? brl(custo.porPedal) : "—", detalhe: custo?.porPedal != null ? "Custo real ÷ pedais bons" : "Registre a produção" },
        ]}
      />

      <div style={{ height: 22 }} />
      <Abas
        base={`lotes/${lote.id}`}
        ativa={aba}
        abas={[
          { id: "geral", rotulo: "Planejamento" },
          { id: "compras", rotulo: "Compras", contagem: compras.length },
          { id: "producao", rotulo: "Produção", contagem: apontamentos.length },
          { id: "custos", rotulo: "Custo real" },
        ]}
      />

      {aba === "geral" && <Planejamento base={base} lote={lote} />}
      {aba === "compras" && <ComprasDoLote base={base} lote={lote} />}
      {aba === "producao" && <ProducaoDoLote base={base} lote={lote} valorHora={config?.valorHora ?? 0} />}
      {aba === "custos" && <CustosDoLote base={base} lote={lote} custos={custos} valorHora={config?.valorHora ?? 0} />}

      {ativo && (
        <div className="rodape-perigo">
          <button
            className="botao fantasma perigo"
            onClick={async () => {
              if (!compras.length && !apontamentos.length) {
                if (await confirmar({ titulo: `Excluir o lote ${lote.codigo}?`, texto: "Ele ainda não tem compras nem produção.", confirmar: "Excluir", perigo: true })) {
                  if (await executar(() => excluirLote(lote.id), "Lote excluído.")) ir("/lotes");
                }
              } else {
                await mudarStatus("cancelado", { titulo: `Cancelar o lote ${lote.codigo}?`, texto: "Compras e produção registradas continuam no histórico.", confirmar: "Cancelar lote", perigo: true });
              }
            }}
          >
            {!compras.length && !apontamentos.length ? "Excluir lote" : "Cancelar lote"}
          </button>
        </div>
      )}

      {editando && <EditorLote base={base} lote={lote} aoFechar={() => setEditando(false)} />}
    </>
  );
}

function Planejamento({ base, lote }: { base: BaseDados; lote: Lote }) {
  const { confirmar } = useFeedback();
  const executar = useExecutar();
  const produtos = mapaPorId(base.produtos);
  const componentes = mapaPorId(base.componentes);
  const itens = base.loteItens.filter((i) => i.loteId === lote.id);
  const saldos = useMemo(() => new Map([...calcularSaldos(base.movimentos)].map(([k, s]) => [k, s.quantidade])), [base.movimentos]);
  const medio = useMemo(() => new Map([...calcularSaldos(base.movimentos)].map(([k, s]) => [k, s.custoMedio])), [base.movimentos]);
  const aReceber = new Map<string, number>();
  for (const c of base.compras.filter((x) => x.loteId === lote.id)) {
    for (const i of base.compraItens.filter((x) => x.compraId === c.id)) aReceber.set(i.componenteId, (aReceber.get(i.componenteId) ?? 0) + quantidadeAReceber(c, i));
  }
  const apIds = new Set(base.apontamentos.filter((a) => a.loteId === lote.id).map((a) => a.id));
  const consumido = new Map<string, number>();
  for (const m of base.movimentos) if (m.refTipo === "apontamento" && m.refId && apIds.has(m.refId)) consumido.set(m.componenteId, (consumido.get(m.componenteId) ?? 0) - m.quantidade);

  const necessidades = necessidadesDoLote({ lote, itens, produtos, composicaoItens: base.composicaoItens, componentes, saldos, aReceber, consumido });
  const preferido = (componenteId: string) => {
    const v = base.componenteFornecedores.filter((x) => x.componenteId === componenteId);
    return v.find((x) => x.preferido) ?? v[0];
  };
  const preco = (componenteId: string) => preferido(componenteId)?.precoRef || medio.get(componenteId) || componentes.get(componenteId)?.custoReferencia || 0;
  const faltando = necessidades.filter((n) => n.aComprar > 0);
  const estimativa = faltando.reduce((a, n) => a + n.aComprar * preco(n.componente.id), 0);
  const outrosAtivos = base.lotes.filter((l) => l.id !== lote.id && ATIVO(l.status));
  const ativo = ATIVO(lote.status);

  // Custo planejado por pedal de cada modelo, com o estoque de hoje.
  const planejado = itens.map((i) => {
    const composicaoId = composicaoDoItem(i, produtos);
    let porPedal = 0;
    let fixo = 0;
    for (const ci of base.composicaoItens.filter((c) => c.composicaoId === composicaoId)) {
      const c = componentes.get(ci.componenteId);
      const v = ci.quantidade * (medio.get(ci.componenteId) || c?.custoReferencia || 0);
      if (!c || c.modoCobranca === "unidade") porPedal += v;
      else fixo += v;
    }
    return { item: i, produto: produtos.get(i.produtoId), porPedal, fixo, versao: base.composicoes.find((c) => c.id === composicaoId)?.versao };
  });

  const gerar = async () => {
    const porFornecedor = new Map<string, number>();
    for (const n of faltando) {
      const nome = base.fornecedores.find((f) => f.id === preferido(n.componente.id)?.fornecedorId)?.nome ?? "Sem fornecedor";
      porFornecedor.set(nome, (porFornecedor.get(nome) ?? 0) + 1);
    }
    const ok = await confirmar({
      titulo: `Gerar ${plural(porFornecedor.size, "pedido", "pedidos")} de compra?`,
      texto: `${[...porFornecedor].map(([f, n]) => `• ${f}: ${plural(n, "peça", "peças")}`).join("\n")}\n\nValor estimado: ${brl(estimativa)}. Os pedidos ficam como “Pedido feito”; ajuste preços e frete quando a nota chegar.`,
      confirmar: "Gerar pedidos",
    });
    if (!ok) return;
    const linhas: LinhaPedido[] = faltando.map((n) => ({ componenteId: n.componente.id, quantidade: n.aComprar, fornecedorId: preferido(n.componente.id)?.fornecedorId, precoUnitario: preco(n.componente.id) }));
    if (await executar(() => gerarPedidos(lote.id, linhas, diaParaIso(hoje())), "Pedidos gerados.")) ir(`/lotes/${lote.id}/compras`);
  };

  return (
    <div className="pilha">
      <Cartao icone={IconePedal} titulo="Pedais do lote">
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Modelo</th>
                <th className="num">Planejados</th>
                <th className="num">Bons</th>
                <th className="num">Refugo</th>
                <th className="num">Peças por pedal</th>
                <th className="num">Fixos do lote</th>
              </tr>
            </thead>
            <tbody>
              {planejado.map(({ item, produto, porPedal, fixo, versao }) => (
                <tr key={item.id}>
                  <td>
                    <div className="celula-com-foto">
                      {produto?.imagem ? <img src={produto.imagem} alt="" className="pedal-mini" /> : <span className="pedal-mini vazia"><IconePedal width={18} height={18} /></span>}
                      <div>
                        <div className="celula-titulo">{produto?.nome ?? item.produtoId}</div>
                        {versao && <div className="sub">Composição v{versao}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="num">{num(item.qtdPlanejada)}</td>
                  <td className="num">{item.qtdProduzida == null ? <span className="fraco">—</span> : num(item.qtdProduzida)}</td>
                  <td className="num">{item.qtdRefugo ? num(item.qtdRefugo) : <span className="fraco">—</span>}</td>
                  <td className="num">{porPedal ? brl(porPedal) : <span className="fraco">—</span>}</td>
                  <td className="num">{fixo ? brl(fixo) : <span className="fraco">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Cartao>

      {ativo ? (
        <Cartao
          icone={ShoppingCart}
          titulo="Peças para o lote"
          sub={
            faltando.length
              ? `Faltam ${plural(faltando.length, "peça", "peças")}, cerca de ${brl(estimativa)} pelos preços de referência.`
              : "Tem tudo: o estoque e os pedidos em aberto cobrem o lote, com a margem de sobra."
          }
          acoes={
            faltando.length > 0 && (
              <button className="botao primario" onClick={gerar}>
                <ShoppingCart aria-hidden="true" />
                Gerar pedidos de compra
              </button>
            )
          }
        >
          {outrosAtivos.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Aviso>
                {plural(outrosAtivos.length, "outro lote em andamento", "outros lotes em andamento")} ({outrosAtivos.map((l) => l.codigo).join(", ")}) também conta com o mesmo estoque. Confira antes de pedir.
              </Aviso>
            </div>
          )}
          <div className="tabela-wrap">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Peça</th>
                  <th className="num">Precisa</th>
                  <th className="num">Com sobra</th>
                  {consumido.size > 0 && <th className="num">Já usado</th>}
                  <th className="num">Em estoque</th>
                  <th className="num">A receber</th>
                  <th className="num">A comprar</th>
                  <th>Fornecedor</th>
                </tr>
              </thead>
              <tbody>
                {necessidades.map((n) => {
                  const f = base.fornecedores.find((x) => x.id === preferido(n.componente.id)?.fornecedorId);
                  return (
                    <tr key={n.componente.id} className={n.aComprar > 0 ? "linha-falta" : ""}>
                      <td>
                        <a className="celula-titulo link-linha" href={`#/estoque/ficha/${n.componente.id}`}>
                          {n.componente.nome}
                        </a>
                        <div className="sub">
                          {n.componente.categoria}
                          {n.componente.modoCobranca !== "unidade" && ` · ${ROTULOS.modoCobranca[n.componente.modoCobranca].toLowerCase()}`}
                        </div>
                      </td>
                      <td className="num">{num(n.necessario)}</td>
                      <td className="num">{num(n.comSobra)}</td>
                      {consumido.size > 0 && <td className="num">{n.consumido ? num(n.consumido) : <span className="fraco">—</span>}</td>}
                      <td className="num">{num(n.emEstoque)}</td>
                      <td className="num">{n.aReceber ? num(n.aReceber) : <span className="fraco">—</span>}</td>
                      <td className="num">
                        {n.aComprar > 0 ? (
                          <span className="a-comprar">
                            <Led cor="ambar" />
                            {num(n.aComprar)}
                          </span>
                        ) : (
                          <span className="positivo">
                            <Check className="icone-ok" aria-label="Coberto" />
                          </span>
                        )}
                      </td>
                      <td>
                        {f?.nome ?? <span className="fraco">—</span>}
                        {n.aComprar > 0 && <div className="sub">{brlUnit(preco(n.componente.id))} cada</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {necessidades.length === 0 && <p className="lista-vazia">Os modelos deste lote não têm peças de estoque na composição.</p>}
          </div>
        </Cartao>
      ) : (
        lote.obs && (
          <Cartao titulo="Observações">
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--legenda)" }}>{lote.obs}</p>
          </Cartao>
        )
      )}
    </div>
  );
}

function ComprasDoLote({ base, lote }: { base: BaseDados; lote: Lote }) {
  const compras = base.compras.filter((c) => c.loteId === lote.id).sort((a, b) => b.data.localeCompare(a.data));
  const nomes = new Map(base.componentes.map((c) => [c.id, c.nome]));
  return (
    <Cartao
      className="cartao-lista"
      icone={ShoppingCart}
      titulo="Compras do lote"
      sub="Pedidos gerados pelo planejamento e compras vinculadas a este lote."
      acoes={
        <a className="botao pequeno" href={`#/compras/nova?lote=${lote.id}`}>
          <Plus aria-hidden="true" />
          Nova compra
        </a>
      }
    >
      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th>Data</th>
              <th>Fornecedor</th>
              <th>Itens</th>
              <th>Situação</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {compras.map((c) => {
              const itens = base.compraItens.filter((i) => i.compraId === c.id);
              return (
                <tr key={c.id} className="clicavel" onClick={() => ir(`/compras/${c.id}`)}>
                  <td className="sem-quebra">{data(c.data)}</td>
                  <td>
                    <a className="celula-titulo link-linha" href={`#/compras/${c.id}`} onClick={(e) => e.stopPropagation()}>
                      {base.fornecedores.find((f) => f.id === c.fornecedorId)?.nome ?? "Fornecedor não informado"}
                    </a>
                  </td>
                  <td className="celula-itens">
                    {itens.slice(0, 3).map((i) => (
                      <div key={i.id}>
                        <span className="fraco">{num(i.quantidade)}×</span> {nomes.get(i.componenteId) ?? i.componenteId}
                      </div>
                    ))}
                    {itens.length > 3 && <div className="sub">+ {plural(itens.length - 3, "item", "itens")}</div>}
                  </td>
                  <td>
                    <Status cor={c.status === "recebida" ? "verde" : c.status === "cancelada" ? "vermelho" : c.status === "recebida_parcial" ? "ambar" : c.status === "rascunho" ? "apagado" : "laranja"}>
                      {ROTULOS.statusCompra[c.status]}
                    </Status>
                  </td>
                  <td className="num">{brl(totalDaCompra(c, itens))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {compras.length === 0 && <p className="lista-vazia">Nenhuma compra vinculada. Gere os pedidos na aba Planejamento.</p>}
      </div>
    </Cartao>
  );
}

function ProducaoDoLote({ base, lote, valorHora }: { base: BaseDados; lote: Lote; valorHora: number }) {
  const [editando, setEditando] = useState<Apontamento | "novo" | null>(null);
  const { confirmar } = useFeedback();
  const executar = useExecutar();
  const produtos = mapaPorId(base.produtos);
  const apontamentos = base.apontamentos.filter((a) => a.loteId === lote.id).sort((a, b) => b.data.localeCompare(a.data));
  const ativo = ATIVO(lote.status);

  return (
    <>
      <Cartao
        className="cartao-lista"
        icone={Wrench}
        titulo="Produção registrada"
        sub="Cada registro baixa do estoque as peças dos pedais montados (bons e refugados) e lança as horas como mão de obra."
        acoes={
          ativo && (
            <button className="botao primario pequeno" onClick={() => setEditando("novo")}>
              <Plus aria-hidden="true" />
              Registrar produção
            </button>
          )
        }
      >
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Modelo</th>
                <th className="num">Bons</th>
                <th className="num">Refugo</th>
                <th className="num">Horas</th>
                <th>Observação</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {apontamentos.map((a) => (
                <tr key={a.id}>
                  <td className="sem-quebra">{data(a.data)}</td>
                  <td className="celula-titulo">{produtos.get(a.produtoId)?.nome ?? a.produtoId}</td>
                  <td className="num">{num(a.qtdBoa)}</td>
                  <td className="num">{a.qtdRefugo ? num(a.qtdRefugo) : <span className="fraco">—</span>}</td>
                  <td className="num">{a.horas ? num(a.horas) : <span className="fraco">—</span>}</td>
                  <td className="fraco">{a.obs}</td>
                  <td className="acao-linha sem-quebra">
                    {ativo && (
                      <>
                        <button type="button" className="botao fantasma icone pequeno" aria-label="Editar registro" onClick={() => setEditando(a)}>
                          <Pencil aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="botao fantasma icone pequeno"
                          aria-label="Excluir registro"
                          onClick={async () => {
                            if (await confirmar({ titulo: "Excluir este registro de produção?", texto: "As peças voltam para o estoque e a mão de obra lançada por ele sai do custo.", confirmar: "Excluir", perigo: true }))
                              await executar(() => excluirApontamento(a.id), "Registro excluído.");
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {apontamentos.length === 0 && (
            <p className="lista-vazia">{ativo ? "Nada registrado ainda. Ao montar pedais, use “Registrar produção”." : "Este lote não tem produção registrada (lotes do app antigo não registravam)."}</p>
          )}
        </div>
      </Cartao>
      {editando && <EditorApontamento base={base} lote={lote} apontamento={editando === "novo" ? undefined : editando} valorHora={valorHora} aoFechar={() => setEditando(null)} />}
    </>
  );
}

function EditorApontamento({ base, lote, apontamento, valorHora, aoFechar }: { base: BaseDados; lote: Lote; apontamento?: Apontamento; valorHora: number; aoFechar: () => void }) {
  const itens = base.loteItens.filter((i) => i.loteId === lote.id);
  const form = useFormulario({
    dia: apontamento ? isoParaDia(apontamento.data) : hoje(),
    produtoId: apontamento?.produtoId ?? itens[0]?.produtoId ?? "",
    qtdBoa: (apontamento?.qtdBoa ?? null) as number | null,
    qtdRefugo: (apontamento?.qtdRefugo ?? null) as number | null,
    horas: (apontamento?.horas ?? null) as number | null,
    obs: apontamento?.obs ?? "",
  });
  const { valores: v, mudar } = form;
  const { avisar } = useFeedback();
  const produtos = mapaPorId(base.produtos);
  const componentes = mapaPorId(base.componentes);
  const montados = (v.qtdBoa ?? 0) + (v.qtdRefugo ?? 0);

  // Prévia do que sai do estoque, com os outros registros do lote considerados.
  const previa = useMemo(() => {
    if (!v.produtoId || !montados) return [];
    const outros = base.apontamentos.filter((a) => a.loteId === lote.id && a.id !== apontamento?.id);
    const este: Apontamento = { id: apontamento?.id ?? "~novo", loteId: lote.id, produtoId: v.produtoId, data: diaParaIso(v.dia), qtdBoa: v.qtdBoa ?? 0, qtdRefugo: v.qtdRefugo ?? 0 };
    const movs = movimentosDeConsumo({ lote, apontamentos: [...outros, este], itens, produtos, composicaoItens: base.composicaoItens, componentes }).filter((m) => m.refId === este.id);
    const saldos = calcularSaldos(base.movimentos.filter((m) => !(m.refTipo === "apontamento" && m.refId === apontamento?.id)));
    return movs.map((m) => ({ componente: componentes.get(m.componenteId)!, quantidade: -m.quantidade, saldo: saldos.get(m.componenteId)?.quantidade ?? 0 }));
  }, [v.produtoId, v.dia, v.qtdBoa, v.qtdRefugo]); // eslint-disable-line react-hooks/exhaustive-deps
  const faltam = previa.filter((p) => p.quantidade > p.saldo);

  const opcoes = [...new Set([...itens.map((i) => i.produtoId), ...base.produtos.filter((p) => p.ativo).map((p) => p.id)])].map((id) => ({
    valor: id,
    rotulo: produtos.get(id)?.nome ?? id,
    grupo: itens.some((i) => i.produtoId === id) ? "No lote" : "Outros modelos",
  }));

  const salvar = async () => {
    form.setTentou(true);
    if (!v.produtoId || !montados) return;
    await salvarApontamento(
      { id: apontamento?.id, loteId: lote.id, produtoId: v.produtoId, data: diaParaIso(v.dia), qtdBoa: v.qtdBoa ?? 0, qtdRefugo: v.qtdRefugo ?? 0, horas: v.horas ?? undefined, obs: v.obs },
      valorHora,
    );
    avisar(`Produção registrada: ${plural(v.qtdBoa ?? 0, "pedal bom", "pedais bons")}. ${plural(previa.length, "componente baixado", "componentes baixados")} do estoque.`);
    aoFechar();
  };

  return (
    <Gaveta titulo={apontamento ? "Editar produção" : "Registrar produção"} sub={`Lote ${lote.codigo}`} aoFechar={aoFechar} aoSalvar={salvar} rotuloSalvar={apontamento ? "Salvar" : "Registrar"} sujo={form.sujo}>
      <div className="formulario">
        <Campo rotulo="Modelo" erro={form.tentou && !v.produtoId && "Escolha o modelo."}>
          <Selecao valor={v.produtoId} aoMudar={(x) => mudar("produtoId", x)} opcoes={opcoes} vazio="Escolha" />
        </Campo>
        <Campo rotulo="Data" htmlFor="ap-dia">
          <Data id="ap-dia" valor={v.dia} aoMudar={(x) => x && mudar("dia", x)} />
        </Campo>
        <Campo rotulo="Pedais bons" erro={form.tentou && !montados && "Informe quantos pedais."} htmlFor="ap-boa">
          <Numero id="ap-boa" valor={v.qtdBoa} aoMudar={(x) => mudar("qtdBoa", x)} sufixo="pedais" />
        </Campo>
        <Campo rotulo="Refugados" opcional htmlFor="ap-ref" dica="Montados que não passaram no teste.">
          <Numero id="ap-ref" valor={v.qtdRefugo} aoMudar={(x) => mudar("qtdRefugo", x)} sufixo="pedais" />
        </Campo>
        <Campo
          rotulo="Horas trabalhadas"
          opcional
          htmlFor="ap-horas"
          dica={
            valorHora > 0 ? (
              v.horas ? `Mão de obra: ${num(v.horas)} h × ${brl(valorHora)} = ${brl(v.horas * valorHora)}` : `Vira mão de obra a ${brl(valorHora)} por hora.`
            ) : (
              <>
                Defina o valor da hora em <a href="#/producao">Produção e custos</a> para lançar a mão de obra.
              </>
            )
          }
        >
          <Numero id="ap-horas" valor={v.horas} aoMudar={(x) => mudar("horas", x)} sufixo="h" />
        </Campo>
        <Campo rotulo="Observação" opcional htmlFor="ap-obs">
          <Texto id="ap-obs" valor={v.obs} aoMudar={(x) => mudar("obs", x)} placeholder="Ex.: números de série 041 a 044" />
        </Campo>
      </div>
      {previa.length > 0 && (
        <div className="gaveta-secao">
          <div className="legenda">Sai do estoque</div>
          {faltam.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Aviso>
                {plural(faltam.length, "peça fica", "peças ficam")} com saldo negativo. Lance as compras que chegaram antes, ou corrija com uma contagem.
              </Aviso>
            </div>
          )}
          <ul className="lista-simples">
            {previa.map((p) => (
              <li key={p.componente.id}>
                <span>{p.componente.nome}</span>
                <span className="fraco">tem {num(p.saldo)}</span>
                <span className={`lista-valor ${p.quantidade > p.saldo ? "negativo" : ""}`}>−{num(p.quantidade)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Gaveta>
  );
}

const TIPOS_CUSTO = Object.entries(ROTULOS.tipoCusto).map(([valor, rotulo]) => ({ valor: valor as TipoCustoFabricacao, rotulo }));

function CustosDoLote({ base, lote, custos, valorHora }: { base: BaseDados; lote: Lote; custos: CustoFabricacao[]; valorHora: number }) {
  const [editando, setEditando] = useState<CustoFabricacao | "novo" | null>(null);
  const { confirmar } = useFeedback();
  const executar = useExecutar();
  const real = useMemo(() => custosDosLotes(base).get(lote.id), [base, lote.id]);
  const apontados = new Set(base.apontamentos.filter((a) => a.loteId === lote.id).map((a) => idCustoDoApontamento(a.id)));
  const ativo = ATIVO(lote.status);
  const termos = real
    ? [
        { nome: "Peças usadas", valor: real.materiais, desc: "Baixadas do estoque pelo custo médio" },
        ...(real.diretos ? [{ nome: "Compras diretas", valor: real.diretos, desc: "Itens que não passam pelo estoque" }] : []),
        { nome: "Mão de obra", valor: real.maoDeObra, desc: `${num(real.horas)} h registradas` },
        { nome: "Outros custos", valor: real.outros, desc: "Energia, consumíveis, terceiros" },
      ]
    : [];

  return (
    <div className="pilha">
      {real && (
        <Cartao titulo="Custo real do lote" sub={real.pedaisBons ? `Dividido pelos ${plural(real.pedaisBons, "pedal bom", "pedais bons")}. Refugados entram no custo dos bons.` : "Aparece depois que a produção for registrada."}>
          <div className="formula">
            {termos.map((t, i) => (
              <div key={t.nome} style={{ display: "contents" }}>
                {i > 0 && (
                  <span className="formula-op" aria-hidden="true">
                    +
                  </span>
                )}
                <div className="formula-termo">
                  <span className="legenda">{t.nome}</span>
                  <strong className="formula-valor">{brl(t.valor)}</strong>
                  <span>{t.desc}</span>
                </div>
              </div>
            ))}
            <span className="formula-op" aria-hidden="true">
              ÷
            </span>
            <div className="formula-termo">
              <span className="legenda">Pedais bons</span>
              <strong className="formula-valor">{num(real.pedaisBons)}</strong>
              <span>{real.refugo ? `${plural(real.refugo, "refugado", "refugados")} (${pct(real.refugo / (real.refugo + real.pedaisBons))})` : "Sem refugo"}</span>
            </div>
            <span className="formula-op" aria-hidden="true">
              =
            </span>
            <div className="formula-termo resultado">
              <span className="legenda">Por pedal</span>
              <strong className="formula-valor">{real.porPedal != null ? brl(real.porPedal) : "—"}</strong>
              <span>Total {brl(real.total)}</span>
            </div>
          </div>
        </Cartao>
      )}

      <Cartao
        className="cartao-lista"
        titulo="Custos de fabricação"
        sub="Mão de obra, energia, consumíveis (solda, fluxo, fita), serviços de terceiros e rateio de custos fixos."
        acoes={
          ativo && (
            <button className="botao pequeno" onClick={() => setEditando("novo")}>
              <Plus aria-hidden="true" />
              Lançar custo
            </button>
          )
        }
      >
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th className="num">Horas</th>
                <th className="num">Valor</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {[...custos]
                .sort((a, b) => b.data.localeCompare(a.data))
                .map((c) => {
                  const doApontamento = apontados.has(c.id);
                  return (
                    <tr key={c.id}>
                      <td className="sem-quebra">{data(c.data)}</td>
                      <td>
                        <Tag>{ROTULOS.tipoCusto[c.tipo]}</Tag>
                      </td>
                      <td>
                        {c.descricao ?? <span className="fraco">—</span>}
                        {doApontamento && <div className="sub">Do registro de produção</div>}
                      </td>
                      <td className="num">{c.horas ? num(c.horas) : <span className="fraco">—</span>}</td>
                      <td className="num">{brl(c.valor)}</td>
                      <td className="acao-linha sem-quebra">
                        {!doApontamento && ativo && (
                          <>
                            <button type="button" className="botao fantasma icone pequeno" aria-label="Editar custo" onClick={() => setEditando(c)}>
                              <Pencil aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="botao fantasma icone pequeno"
                              aria-label="Excluir custo"
                              onClick={async () => {
                                if (await confirmar({ titulo: "Excluir este custo?", texto: `${ROTULOS.tipoCusto[c.tipo]} de ${brl(c.valor)}.`, confirmar: "Excluir", perigo: true }))
                                  await executar(() => excluirCustoFabricacao(c.id), "Custo excluído.");
                              }}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {custos.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="num">{brl(custos.reduce((a, c) => a + c.valor, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          {custos.length === 0 && <p className="lista-vazia">Nenhum custo lançado. As horas dos registros de produção entram aqui sozinhas.</p>}
        </div>
      </Cartao>
      {editando && <EditorCusto lote={lote} custo={editando === "novo" ? undefined : editando} valorHora={valorHora} aoFechar={() => setEditando(null)} />}
    </div>
  );
}

function EditorCusto({ lote, custo, valorHora, aoFechar }: { lote: Lote; custo?: CustoFabricacao; valorHora: number; aoFechar: () => void }) {
  const form = useFormulario({
    tipo: (custo?.tipo ?? "consumiveis") as TipoCustoFabricacao,
    descricao: custo?.descricao ?? "",
    valor: (custo?.valor ?? null) as number | null,
    horas: (custo?.horas ?? null) as number | null,
    dia: custo ? isoParaDia(custo.data) : hoje(),
  });
  const { valores: v, mudar } = form;
  const { avisar } = useFeedback();

  const salvar = async () => {
    form.setTentou(true);
    if (!(v.valor && v.valor > 0)) return;
    await salvarCustoFabricacao({ id: custo?.id, loteId: lote.id, tipo: v.tipo, descricao: v.descricao, valor: v.valor, horas: v.horas ?? undefined, data: diaParaIso(v.dia) });
    avisar("Custo lançado.");
    aoFechar();
  };

  return (
    <Gaveta titulo={custo ? "Editar custo" : "Lançar custo"} sub={`Lote ${lote.codigo}`} aoFechar={aoFechar} aoSalvar={salvar} sujo={form.sujo}>
      <div className="formulario">
        <Campo rotulo="Tipo" inteiro>
          <Selecao valor={v.tipo} aoMudar={(x) => mudar("tipo", x)} opcoes={TIPOS_CUSTO} />
        </Campo>
        {v.tipo === "mao_de_obra" && (
          <Campo rotulo="Horas" htmlFor="cf-horas" dica={valorHora ? `A ${brl(valorHora)} por hora.` : undefined}>
            <Numero
              id="cf-horas"
              valor={v.horas}
              aoMudar={(x) => {
                mudar("horas", x);
                if (valorHora && x) mudar("valor", Math.round(x * valorHora * 100) / 100);
              }}
              sufixo="h"
            />
          </Campo>
        )}
        <Campo rotulo="Valor" erro={form.tentou && !(v.valor && v.valor > 0) && "Informe o valor."} htmlFor="cf-valor">
          <Moeda id="cf-valor" valor={v.valor} aoMudar={(x) => mudar("valor", x)} />
        </Campo>
        <Campo rotulo="Data" htmlFor="cf-dia">
          <Data id="cf-dia" valor={v.dia} aoMudar={(x) => x && mudar("dia", x)} />
        </Campo>
        <Campo rotulo="Descrição" inteiro opcional htmlFor="cf-desc">
          <Texto id="cf-desc" valor={v.descricao} aoMudar={(x) => mudar("descricao", x)} placeholder="Ex.: solda e fluxo, gravação a laser das caixas" />
        </Campo>
      </div>
    </Gaveta>
  );
}
