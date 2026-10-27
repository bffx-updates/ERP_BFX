import { ClipboardList, History, Package, Printer, SlidersHorizontal, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { aplicarContagem, excluirMovimento, lancarMovimento, movimentoManual, type LancamentoManual } from "../data/acoes";
import { useBase } from "../data/consultas";
import { calcularSaldos, importadoDepois, livroDeEstoque, saldosParaContagem, situacao, type LinhaLivro } from "../data/estoque";
import { agruparPor, brl, brlUnit, combina, data, diaParaIso, fimDoDiaIso, hoje, mesDe, mesLocal, nomeDoMes, num, plural, ROTULOS } from "../data/formato";
import { fezContagemDeTransicao, type BaseDados } from "../data/relatorios";
import type { Componente, Movimento, TipoMovimento } from "../data/tipos";
import { Aviso, Cabecalho, Cartao, Faixa, Led, Status, Tag, useFeedback, type CorLed } from "../ui/base";
import { Busca, Campo, Data, Escolha, Filtros, Interruptor, Moeda, Numero, Segmentado, Selecao, Texto, useFormulario } from "../ui/form";
import { Abas, Gaveta, useExecutar } from "../ui/gaveta";
import { ir, trocarQuery, useLocal, useProtegerSaida } from "../ui/rota";
import { SemDados } from "./comum";

const SITUACAO: Record<string, { cor: CorLed; texto: string }> = {
  zerado: { cor: "vermelho", texto: "Zerado" },
  baixo: { cor: "ambar", texto: "Baixo" },
  ok: { cor: "verde", texto: "Disponível" },
};

export function Estoque() {
  const base = useBase();
  const local = useLocal();
  if (!base) return null;
  const aba = local.partes[0] === "ajuste" || !local.partes[0] ? "saldo" : local.partes[0];
  const estocaveis = base.componentes.filter((c) => c.controlaEstoque);

  return (
    <>
      <Cabecalho
        sobretitulo="Operação"
        titulo="Estoque"
        descricao="O saldo de cada peça é a soma do livro de movimentações. O valor usa o custo médio ponderado, recalculado a cada entrada."
        acoes={
          <>
            <a className="botao" href="#/estoque/contagem">
              <ClipboardList aria-hidden="true" />
              Contagem física
            </a>
            <a className="botao primario" href="#/estoque/ajuste">
              <SlidersHorizontal aria-hidden="true" />
              Ajustar estoque
            </a>
          </>
        }
      />
      {estocaveis.length === 0 ? (
        <SemDados titulo="Estoque vazio" icone={Package} texto="Cadastre componentes e lance compras para o estoque aparecer aqui." novo={{ rotulo: "Cadastrar componente", href: "#/componentes/novo" }} />
      ) : (
        <>
          <Abas
            base="estoque"
            ativa={aba}
            abas={[
              { id: "saldo", rotulo: "Saldo" },
              { id: "movimentacoes", rotulo: "Movimentações", contagem: base.movimentos.length },
              { id: "contagem", rotulo: "Contagem física" },
              { id: "ficha", rotulo: "Ficha por componente" },
            ]}
          />
          {aba === "saldo" && <Saldo base={base} />}
          {aba === "movimentacoes" && <Movimentacoes base={base} />}
          {aba === "contagem" && <Contagem base={base} />}
          {aba === "ficha" && <Ficha base={base} componenteId={local.partes[1]} />}
        </>
      )}
      {local.partes[0] === "ajuste" && <EditorAjuste base={base} componenteId={local.partes[1]} aoFechar={() => ir(local.partes[1] ? `/estoque/ficha/${local.partes[1]}` : "/estoque")} />}
    </>
  );
}

function Saldo({ base }: { base: BaseDados }) {
  const local = useLocal();
  const [busca, setBusca] = useState("");
  const filtro = local.query.get("filtro") ?? "todos";
  const linhas = useMemo(() => {
    const saldos = calcularSaldos(base.movimentos);
    return base.componentes
      .filter((c) => c.controlaEstoque && (c.ativo || (saldos.get(c.id)?.quantidade ?? 0) !== 0))
      .map((c) => {
        const saldo = saldos.get(c.id) ?? { quantidade: 0, custoMedio: 0, valor: 0 };
        return { componente: c, saldo, situacao: situacao(saldo.quantidade, c.estoqueMinimo) };
      })
      .sort((a, b) => a.componente.categoria.localeCompare(b.componente.categoria, "pt-BR") || a.componente.nome.localeCompare(b.componente.nome, "pt-BR"));
  }, [base]);
  const total = linhas.reduce((a, l) => a + l.saldo.valor, 0);
  const abaixo = linhas.filter((l) => l.situacao !== "ok");
  const negativos = linhas.filter((l) => l.saldo.quantidade < 0);
  const mes = mesDe();
  const visiveis = linhas.filter((l) => {
    if (filtro === "abaixo" && l.situacao === "ok") return false;
    if (filtro === "zerados" && l.situacao !== "zerado") return false;
    if (filtro === "com_saldo" && !(l.saldo.quantidade > 0)) return false;
    if (filtro === "negativo" && !(l.saldo.quantidade < 0)) return false;
    return combina(busca, l.componente.nome, l.componente.variante, l.componente.categoria, l.componente.sku);
  });
  const grupos = agruparPor(visiveis, (l) => l.componente.categoria);

  return (
    <div className="pilha">
      <Faixa
        itens={[
          { rotulo: "Valor em estoque", valor: brl(total), detalhe: "Pelo custo médio" },
          { rotulo: "Com saldo", valor: num(linhas.filter((l) => l.saldo.quantidade > 0).length), detalhe: `de ${plural(linhas.length, "componente", "componentes")}` },
          { rotulo: "Abaixo do mínimo", valor: num(abaixo.length), detalhe: abaixo.length ? "Zerados ou no limite" : "Nenhum" },
          { rotulo: `Movimentos em ${nomeDoMes(mes).split(" ")[0]}`, valor: num(base.movimentos.filter((m) => mesLocal(m.data) === mes).length), detalhe: "Entradas e saídas" },
        ]}
      />
      {negativos.length > 0 && (
        <Aviso titulo={`${plural(negativos.length, "componente com saldo negativo", "componentes com saldo negativo")}`} erro>
          Saiu mais do que entrou. Falta lançar uma compra ou corrigir com uma contagem física.
        </Aviso>
      )}
      <Cartao className="cartao-lista">
        <div className="barra">
          <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar componente…" />
          <Filtros
            ativo={filtro}
            aoMudar={(id) => trocarQuery("filtro", id === "todos" ? undefined : id)}
            opcoes={[
              { id: "todos", rotulo: "Todos", contagem: linhas.length },
              { id: "com_saldo", rotulo: "Com saldo" },
              { id: "abaixo", rotulo: "Abaixo do mínimo", contagem: abaixo.length, alerta: true },
              { id: "zerados", rotulo: "Zerados" },
              ...(negativos.length ? [{ id: "negativo", rotulo: "Negativos", contagem: negativos.length, alerta: true }] : []),
            ]}
          />
        </div>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Componente</th>
                <th>Situação</th>
                <th className="num">Saldo</th>
                <th className="num">Mínimo</th>
                <th className="num">Custo médio</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map(([categoria, itens]) => (
                <Fragment key={categoria}>
                  <tr className="grupo">
                    <td colSpan={6}>
                      <span className="legenda grupo-nome">{categoria}</span>
                      <span className="grupo-conta">{itens.length}</span>
                    </td>
                  </tr>
                  {itens.map(({ componente: c, saldo, situacao: s }) => (
                    <tr key={c.id} className="clicavel" onClick={() => ir(`/estoque/ficha/${c.id}`)}>
                      <td>
                        <a className="celula-titulo link-linha" href={`#/estoque/ficha/${c.id}`} onClick={(e) => e.stopPropagation()}>
                          {c.nome}
                        </a>
                        {c.variante && <div className="sub">{c.variante}</div>}
                      </td>
                      <td>{saldo.quantidade < 0 ? <Status cor="vermelho">Negativo</Status> : <Status cor={SITUACAO[s].cor}>{SITUACAO[s].texto}</Status>}</td>
                      <td className={`num ${saldo.quantidade < 0 ? "negativo" : ""}`}>
                        {num(saldo.quantidade)} <span className="fraco">{c.unidade}</span>
                      </td>
                      <td className="num fraco">{c.estoqueMinimo ? num(c.estoqueMinimo) : "—"}</td>
                      <td className="num">{saldo.custoMedio ? brlUnit(saldo.custoMedio) : <span className="fraco">—</span>}</td>
                      <td className="num">{brl(saldo.valor)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>{busca || filtro !== "todos" ? `Total dos ${plural(visiveis.length, "componente", "componentes")} filtrados` : "Total em estoque"}</td>
                <td className="num">{brl(visiveis.reduce((a, l) => a + l.saldo.valor, 0))}</td>
              </tr>
            </tfoot>
          </table>
          {visiveis.length === 0 && <p className="lista-vazia">Nenhum componente com esse filtro.</p>}
        </div>
      </Cartao>
    </div>
  );
}

// De onde veio o movimento, com link para a origem.
function Origem({ m, base }: { m: Movimento; base: BaseDados }) {
  if (m.refTipo === "compra" && m.refId) {
    const c = base.compras.find((x) => x.id === m.refId);
    const f = base.fornecedores.find((x) => x.id === c?.fornecedorId);
    return <a href={`#/compras/${m.refId}`}>Compra{f ? ` · ${f.nome}` : ""}</a>;
  }
  if (m.refTipo === "apontamento" && m.refId) {
    const a = base.apontamentos.find((x) => x.id === m.refId);
    const l = base.lotes.find((x) => x.id === a?.loteId);
    return l ? <a href={`#/lotes/${l.id}/producao`}>Lote {l.codigo}</a> : <span className="fraco">Produção</span>;
  }
  if (m.refTipo === "inventario") return <span>Contagem física</span>;
  if (m.refTipo === "importacao") return <span className="fraco">App antigo</span>;
  return <span>Lançamento manual</span>;
}

function Movimentacoes({ base }: { base: BaseDados }) {
  const local = useLocal();
  const mes = local.query.get("mes") ?? "";
  const tipo = local.query.get("tipo") ?? "";
  const [busca, setBusca] = useState("");
  const { confirmar } = useFeedback();
  const executar = useExecutar();
  const livro = useMemo(() => livroDeEstoque(base.movimentos), [base.movimentos]);
  const nomes = useMemo(() => new Map(base.componentes.map((c) => [c.id, c])), [base.componentes]);
  const meses = [...new Set(base.movimentos.map((m) => mesLocal(m.data)))].sort().reverse();
  const visiveis = livro
    .filter((x) => (!mes || mesLocal(x.movimento.data) === mes) && (!tipo || x.movimento.tipo === tipo) && combina(busca, nomes.get(x.movimento.componenteId)?.nome, x.movimento.obs))
    .reverse();
  const entradas = visiveis.filter((x) => x.movimento.quantidade > 0).reduce((a, x) => a + x.valor, 0);
  const saidas = visiveis.filter((x) => x.movimento.quantidade < 0).reduce((a, x) => a - x.valor, 0);
  const mostrar = visiveis.slice(0, 300);

  return (
    <Cartao className="cartao-lista">
      <div className="barra">
        <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar componente ou observação…" />
        <div className="mes-filtro">
          <Selecao valor={mes} aoMudar={(m) => trocarQuery("mes", m || undefined)} vazio="Todos os meses" opcoes={meses.map((m) => ({ valor: m, rotulo: nomeDoMes(m) }))} />
        </div>
        <div className="mes-filtro">
          <Selecao
            valor={tipo}
            aoMudar={(t) => trocarQuery("tipo", t || undefined)}
            vazio="Todos os tipos"
            opcoes={Object.entries(ROTULOS.tipoMovimento).map(([valor, rotulo]) => ({ valor, rotulo }))}
          />
        </div>
      </div>
      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th>Data</th>
              <th>Componente</th>
              <th>Tipo</th>
              <th>Origem</th>
              <th className="num">Qtd</th>
              <th className="num">Custo unit.</th>
              <th className="num">Valor</th>
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {mostrar.map(({ movimento: m, custoUnitario, valor }) => (
              <tr key={m.id}>
                <td className="sem-quebra">{data(m.data)}</td>
                <td>
                  <a className="celula-titulo link-linha" href={`#/estoque/ficha/${m.componenteId}`}>
                    {nomes.get(m.componenteId)?.nome ?? m.componenteId}
                  </a>
                  {m.obs && <div className="sub">{m.obs}</div>}
                </td>
                <td>
                  <Tag>{ROTULOS.tipoMovimento[m.tipo]}</Tag>
                </td>
                <td>
                  <Origem m={m} base={base} />
                </td>
                <td className={`num ${m.quantidade < 0 ? "negativo" : "positivo"}`}>
                  {m.quantidade > 0 ? "+" : ""}
                  {num(m.quantidade)}
                </td>
                <td className="num">{brlUnit(custoUnitario)}</td>
                <td className="num">{brl(valor)}</td>
                <td className="acao-linha">
                  {movimentoManual(m) && (
                    <button
                      type="button"
                      className="botao fantasma icone pequeno"
                      aria-label="Excluir lançamento"
                      title="Excluir lançamento"
                      onClick={async () => {
                        if (await confirmar({ titulo: "Excluir este lançamento?", texto: `${ROTULOS.tipoMovimento[m.tipo]} de ${num(m.quantidade)} ${nomes.get(m.componenteId)?.nome ?? ""} em ${data(m.data)}. O saldo e o custo médio são recalculados.`, confirmar: "Excluir", perigo: true }))
                          await executar(() => excluirMovimento(m.id), "Lançamento excluído.");
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {visiveis.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>
                  {plural(visiveis.length, "movimento", "movimentos")}
                  {visiveis.length > mostrar.length ? ` (mostrando os ${mostrar.length} mais recentes)` : ""}
                </td>
                <td colSpan={3} className="num">
                  <span className="positivo">Entradas {brl(entradas)}</span>
                  <span className="separador">·</span>
                  <span className="negativo">Saídas {brl(saidas)}</span>
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        {visiveis.length === 0 && <p className="lista-vazia">Nenhum movimento com esse filtro.</p>}
      </div>
    </Cartao>
  );
}

function Contagem({ base }: { base: BaseDados }) {
  const temSaldoInicial = fezContagemDeTransicao(base);
  const transicao = !!base.empresa.dataTransicao && !temSaldoInicial;
  const [dia, setDia] = useState(transicao ? base.empresa.dataTransicao : hoje());
  const [saldoInicial, setSaldoInicial] = useState(transicao);
  const [contados, setContados] = useState<Record<string, number | null>>({});
  const [busca, setBusca] = useState("");
  const { confirmar, avisar } = useFeedback();
  const executar = useExecutar();

  const saldos = useMemo(() => saldosParaContagem(base.movimentos, fimDoDiaIso(dia), saldoInicial), [base.movimentos, dia, saldoInicial]);
  const importadosDepois = saldoInicial ? base.movimentos.filter((m) => importadoDepois(m, fimDoDiaIso(dia))).length : 0;
  const componentes = base.componentes
    .filter((c) => c.controlaEstoque && (c.ativo || (saldos.get(c.id)?.quantidade ?? 0) !== 0))
    .sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
  const linhas = componentes.map((c) => {
    const s = saldos.get(c.id);
    const sistema = s?.quantidade ?? 0;
    const contado = contados[c.id];
    const diferenca = contado == null ? 0 : contado - sistema;
    const custo = s?.custoMedio || c.custoReferencia || 0;
    return { componente: c, sistema, contado, diferenca, valor: diferenca * custo };
  });
  const preenchidos = linhas.filter((l) => l.contado != null);
  useProtegerSaida(preenchidos.length > 0);
  const comDiferenca = preenchidos.filter((l) => Math.abs(l.diferenca) > 1e-9);
  const visiveis = linhas.filter((l) => combina(busca, l.componente.nome, l.componente.categoria, l.componente.variante));
  const grupos = agruparPor(visiveis, (l) => l.componente.categoria);

  const aplicar = async () => {
    if (!preenchidos.length) return;
    const ok = await confirmar({
      titulo: saldoInicial ? "Gravar o saldo inicial da transição?" : "Aplicar a contagem?",
      texto: `${plural(comDiferenca.length, "componente tem diferença", "componentes têm diferença")} e ${comDiferenca.length === 1 ? "vira um ajuste" : "viram ajustes"} em ${data(`${dia}T12:00:00`)}. Valor líquido dos ajustes: ${brl(comDiferenca.reduce((a, l) => a + l.valor, 0))}.${saldoInicial ? "\n\nOs ajustes ficam marcados como saldo inicial da transição MEI → ME." : ""}${importadosDepois ? "\n\nO saldo importado do app antigo depois desta data é substituído pela contagem." : ""}`,
      confirmar: "Aplicar",
    });
    if (!ok) return;
    const r = await executar(() => aplicarContagem(dia, preenchidos.map((l) => ({ componenteId: l.componente.id, contado: l.contado! })), saldoInicial));
    if (r) {
      setContados({});
      avisar(r.ajustes ? `Contagem aplicada: ${plural(r.ajustes, "ajuste lançado", "ajustes lançados")}.` : "Contagem aplicada: o estoque já batia com o contado.");
      ir("/estoque/movimentacoes");
    }
  };

  return (
    <div className="pilha">
      <Cartao icone={ClipboardList} titulo="Como funciona" sub="Conte as peças, digite o que contou e o app gera os ajustes das diferenças. Só as linhas preenchidas entram.">
        <div className="contagem-topo">
          <Campo rotulo="Data da contagem" htmlFor="ct-dia">
            <Data id="ct-dia" valor={dia} aoMudar={(x) => x && setDia(x)} />
          </Campo>
          <Interruptor
            ligado={saldoInicial}
            aoMudar={setSaldoInicial}
            rotulo="É a contagem da transição MEI → ME"
            descricao={base.empresa.dataTransicao ? `Saída do MEI em ${data(`${base.empresa.dataTransicao}T12:00:00`)}. Os ajustes viram o saldo inicial oficial.` : "Informe a data de saída do MEI em Dados e backup."}
          />
          <div className="acoes contagem-acoes nao-imprimir">
            <button type="button" className="botao" onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              Imprimir folha
            </button>
            <button
              type="button"
              className="botao"
              onClick={() => setContados(Object.fromEntries(linhas.map((l) => [l.componente.id, Math.max(0, l.sistema)])))}
              title="Preenche tudo com o saldo do sistema; depois corrija só o que for diferente."
            >
              Preencher com o sistema
            </button>
            <button type="button" className="botao primario" onClick={aplicar} disabled={!preenchidos.length}>
              Aplicar contagem
            </button>
          </div>
        </div>
      </Cartao>
      {importadosDepois > 0 && (
        <Aviso titulo="O saldo do app antigo entra nesta contagem">
          Ele foi importado depois de {data(`${dia}T12:00:00`)}, mas são peças que já existiam. Aparece em “No sistema” e, ao aplicar, é substituído pelo que você contou.
        </Aviso>
      )}
      {temSaldoInicial && saldoInicial && <Aviso titulo="Já existe um saldo inicial de transição">Uma nova contagem marcada como saldo inicial soma ajustes aos já existentes. Use uma contagem comum para corrigir.</Aviso>}
      <Cartao className="cartao-lista folha-contagem">
        <div className="barra nao-imprimir">
          <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar componente…" />
          <span className="fraco" style={{ fontSize: 13 }}>
            {plural(preenchidos.length, "contado", "contados")} · {plural(comDiferenca.length, "com diferença", "com diferença")}
          </span>
        </div>
        <div className="tabela-wrap">
          <table className="tabela tabela-edicao">
            <thead>
              <tr>
                <th>Componente</th>
                <th className="num">No sistema</th>
                <th className="num col-qtd">Contado</th>
                <th className="num">Diferença</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map(([categoria, itens]) => (
                <Fragment key={categoria}>
                  <tr className="grupo">
                    <td colSpan={5}>
                      <span className="legenda grupo-nome">{categoria}</span>
                    </td>
                  </tr>
                  {itens.map((l) => (
                    <tr key={l.componente.id}>
                      <td>
                        <div className="celula-titulo">{l.componente.nome}</div>
                        {l.componente.variante && <div className="sub">{l.componente.variante}</div>}
                      </td>
                      <td className="num">
                        {num(l.sistema)} <span className="fraco">{l.componente.unidade}</span>
                      </td>
                      <td>
                        <Numero valor={l.contado} aoMudar={(x) => setContados((c) => ({ ...c, [l.componente.id]: x }))} placeholder="—" aria-label={`Contado de ${l.componente.nome}`} />
                      </td>
                      <td className={`num ${l.diferenca > 0 ? "positivo" : l.diferenca < 0 ? "negativo" : "fraco"}`}>
                        {l.contado == null ? "" : `${l.diferenca > 0 ? "+" : ""}${num(l.diferenca)}`}
                      </td>
                      <td className="num">{l.contado != null && l.diferenca ? brl(l.valor) : ""}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Cartao>
    </div>
  );
}

function Ficha({ base, componenteId }: { base: BaseDados; componenteId?: string }) {
  const estocaveis = base.componentes.filter((c) => c.controlaEstoque).sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
  const componente = base.componentes.find((c) => c.id === componenteId);
  const linhas: LinhaLivro[] = useMemo(() => (componente ? livroDeEstoque(base.movimentos.filter((m) => m.componenteId === componente.id)) : []), [base.movimentos, componente]);
  const final = linhas[linhas.length - 1];

  return (
    <div className="pilha">
      <Cartao icone={History} titulo="Ficha de estoque" sub="Todas as entradas e saídas de uma peça, com o saldo e o custo médio depois de cada uma.">
        <div className="ficha-topo">
          <div className="ficha-escolha">
            <Escolha
              valor={componenteId}
              aoMudar={(id) => ir(`/estoque/ficha/${id}`)}
              opcoes={estocaveis.map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: c.variante, grupo: c.categoria }))}
              placeholder="Escolha o componente"
              autoFocus={!componenteId}
            />
          </div>
          {componente && (
            <div className="acoes nao-imprimir">
              <a className="botao" href={`#/componentes/${componente.id}`}>
                Cadastro
              </a>
              <a className="botao" href={`#/estoque/ajuste/${componente.id}`}>
                <SlidersHorizontal aria-hidden="true" />
                Ajustar
              </a>
              <button type="button" className="botao" onClick={() => window.print()}>
                <Printer aria-hidden="true" />
                Imprimir
              </button>
            </div>
          )}
        </div>
        {componente && (
          <div className="gaveta-resumo" style={{ margin: "18px 0 0" }}>
            <div>
              <div className="legenda">Saldo</div>
              <strong className={final && final.saldoQuantidade < 0 ? "negativo" : ""}>
                {num(final?.saldoQuantidade ?? 0)} {componente.unidade}
              </strong>
            </div>
            <div>
              <div className="legenda">Custo médio</div>
              <strong>{brlUnit(final?.custoMedio ?? 0)}</strong>
            </div>
            <div>
              <div className="legenda">Valor</div>
              <strong>{brl(final?.saldoValor ?? 0)}</strong>
            </div>
            <div>
              <div className="legenda">Mínimo</div>
              <strong>{componente.estoqueMinimo ? num(componente.estoqueMinimo) : "—"}</strong>
            </div>
          </div>
        )}
      </Cartao>
      {componente && (
        <Cartao className="cartao-lista">
          <div className="tabela-wrap" style={{ borderTop: 0 }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Histórico</th>
                  <th className="num">Entrada</th>
                  <th className="num">Saída</th>
                  <th className="num">Custo unit.</th>
                  <th className="num">Saldo</th>
                  <th className="num">Custo médio</th>
                  <th className="num">Valor do saldo</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((x) => (
                  <tr key={x.movimento.id}>
                    <td className="sem-quebra">{data(x.movimento.data)}</td>
                    <td>
                      <div>{ROTULOS.tipoMovimento[x.movimento.tipo]}</div>
                      <div className="sub">
                        <Origem m={x.movimento} base={base} />
                        {x.movimento.obs ? ` · ${x.movimento.obs}` : ""}
                      </div>
                    </td>
                    <td className="num positivo">{x.movimento.quantidade > 0 ? num(x.movimento.quantidade) : ""}</td>
                    <td className="num negativo">{x.movimento.quantidade < 0 ? num(-x.movimento.quantidade) : ""}</td>
                    <td className="num">{brlUnit(x.custoUnitario)}</td>
                    <td className={`num ${x.saldoQuantidade < 0 ? "negativo" : ""}`}>{num(x.saldoQuantidade)}</td>
                    <td className="num">{brlUnit(x.custoMedio)}</td>
                    <td className="num">{brl(x.saldoValor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {linhas.length === 0 && <p className="lista-vazia">Nenhum movimento desta peça ainda.</p>}
          </div>
        </Cartao>
      )}
    </div>
  );
}

type TipoAjuste = "entrada" | "saida" | "perda" | "devolucao";
const TIPOS_AJUSTE: { valor: TipoAjuste; rotulo: string; tipo: Extract<TipoMovimento, "ajuste" | "perda" | "devolucao">; sinal: 1 | -1; dica: string }[] = [
  { valor: "entrada", rotulo: "Entrada avulsa", tipo: "ajuste", sinal: 1, dica: "Peça que apareceu, brinde, sobra de outro lote. Para compras, use Compras." },
  { valor: "saida", rotulo: "Saída avulsa", tipo: "ajuste", sinal: -1, dica: "Uso fora de um lote: protótipo, conserto, amostra." },
  { valor: "perda", rotulo: "Perda ou defeito", tipo: "perda", sinal: -1, dica: "Peça queimada, quebrada ou extraviada." },
  { valor: "devolucao", rotulo: "Devolução", tipo: "devolucao", sinal: -1, dica: "Peça devolvida ao fornecedor." },
];

function EditorAjuste({ base, componenteId, aoFechar }: { base: BaseDados; componenteId?: string; aoFechar: () => void }) {
  const form = useFormulario({ componenteId: componenteId ?? "", tipo: "entrada" as TipoAjuste, quantidade: null as number | null, custo: null as number | null, dia: hoje(), obs: "" });
  const { valores: v, mudar } = form;
  const { avisar } = useFeedback();
  const saldo = useMemo(() => calcularSaldos(base.movimentos.filter((m) => m.componenteId === v.componenteId)).get(v.componenteId), [base.movimentos, v.componenteId]);
  const componente: Componente | undefined = base.componentes.find((c) => c.id === v.componenteId);
  const tipo = TIPOS_AJUSTE.find((t) => t.valor === v.tipo)!;
  const qtd = (v.quantidade ?? 0) * tipo.sinal;
  const depois = (saldo?.quantidade ?? 0) + qtd;
  const custoSugerido = saldo?.custoMedio || componente?.custoReferencia || 0;

  const salvar = async () => {
    form.setTentou(true);
    if (!v.componenteId || !(v.quantidade && v.quantidade > 0)) return;
    if (tipo.sinal < 0 && !v.obs.trim()) return;
    const l: LancamentoManual = {
      componenteId: v.componenteId,
      tipo: tipo.tipo,
      quantidade: qtd,
      custoUnitario: tipo.sinal > 0 ? (v.custo ?? custoSugerido) : undefined,
      data: diaParaIso(v.dia),
      obs: v.obs,
    };
    await lancarMovimento(l);
    avisar(`${tipo.rotulo} lançada: ${num(v.quantidade)} ${componente?.unidade ?? ""} de ${componente?.nome ?? ""}.`);
    aoFechar();
  };

  return (
    <Gaveta titulo="Ajustar estoque" sub="Para entradas e saídas que não vêm de compras nem da produção." aoFechar={aoFechar} aoSalvar={salvar} rotuloSalvar="Lançar" sujo={form.sujo}>
      <div className="formulario">
        <Campo rotulo="Componente" inteiro erro={form.tentou && !v.componenteId && "Escolha o componente."}>
          <Escolha
            valor={v.componenteId}
            aoMudar={(x) => mudar("componenteId", x)}
            opcoes={base.componentes
              .filter((c) => c.controlaEstoque && c.ativo)
              .sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"))
              .map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: c.variante, grupo: c.categoria }))}
            placeholder="Qual peça?"
            autoFocus={!componenteId}
          />
        </Campo>
        <Campo rotulo="Tipo" inteiro dica={tipo.dica}>
          <Segmentado rotulo="Tipo de ajuste" valor={v.tipo} aoMudar={(x) => mudar("tipo", x)} opcoes={TIPOS_AJUSTE} />
        </Campo>
        <Campo rotulo="Quantidade" erro={form.tentou && !(v.quantidade && v.quantidade > 0) && "Informe a quantidade."} htmlFor="aj-qtd">
          <Numero id="aj-qtd" valor={v.quantidade} aoMudar={(x) => mudar("quantidade", x)} sufixo={componente?.unidade ?? "un"} />
        </Campo>
        <Campo rotulo="Data" htmlFor="aj-dia">
          <Data id="aj-dia" valor={v.dia} aoMudar={(x) => x && mudar("dia", x)} />
        </Campo>
        {tipo.sinal > 0 && (
          <Campo rotulo="Custo unitário" inteiro htmlFor="aj-custo" dica={`Em branco, usa ${custoSugerido ? brlUnit(custoSugerido) : "o custo médio"} (${saldo?.custoMedio ? "custo médio atual" : "custo de referência"}).`}>
            <Moeda id="aj-custo" casas={4} valor={v.custo} aoMudar={(x) => mudar("custo", x)} placeholder={custoSugerido ? String(custoSugerido.toFixed(4)).replace(".", ",") : ""} />
          </Campo>
        )}
        <Campo rotulo="Motivo" inteiro opcional={tipo.sinal > 0} erro={form.tentou && tipo.sinal < 0 && !v.obs.trim() && "Conte o motivo: o contador pergunta sobre saídas sem nota."} htmlFor="aj-obs">
          <Texto id="aj-obs" valor={v.obs} aoMudar={(x) => mudar("obs", x)} placeholder={tipo.valor === "perda" ? "Ex.: 2 queimadas no teste de bancada" : "Ex.: usado no protótipo do NANO v2"} />
        </Campo>
      </div>
      {componente && (
        <div className="gaveta-resumo" style={{ marginTop: 22, marginBottom: 0 }}>
          <div>
            <div className="legenda">Saldo agora</div>
            <strong>
              {num(saldo?.quantidade ?? 0)} {componente.unidade}
            </strong>
          </div>
          <div>
            <div className="legenda">Depois</div>
            <strong className={depois < 0 ? "negativo" : ""}>
              {num(depois)} {componente.unidade}
            </strong>
          </div>
          {depois < 0 && (
            <span className="negativo" style={{ fontSize: 12.5 }}>
              <Led cor="vermelho" /> O saldo fica negativo.
            </span>
          )}
        </div>
      )}
      {v.dia < hoje() && <p className="nota">Lançamento com data retroativa: o custo médio das saídas seguintes é recalculado.</p>}
    </Gaveta>
  );
}
