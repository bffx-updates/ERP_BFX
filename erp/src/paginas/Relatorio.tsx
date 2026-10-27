// Relatórios para a contabilidade, em formato de documento: na tela parece uma folha A4,
// e "Imprimir → Salvar como PDF" gera o arquivo para mandar ao contador.
import { ArrowLeft, Printer } from "lucide-react";
import { Fragment, useMemo, type ReactNode } from "react";
import { useBase } from "../data/consultas";
import { livroDeEstoque } from "../data/estoque";
import { brl, brlUnit, data, dataEHora, fimDoDiaIso, formatarChave, formatarDocumento, formatarNCM, inicioDoDiaIso, num, periodoPorExtenso, plural, ROTULOS, soDocumento } from "../data/formato";
import { comprasNoPeriodo, custosDosLotes, inventarioEm, mapaPorId, movimentacaoNoPeriodo, pendenciasFiscais, producaoNoPeriodo, type BaseDados } from "../data/relatorios";
import { useLocal } from "../ui/rota";

const TITULOS: Record<string, string> = {
  fechamento: "Fechamento contábil",
  compras: "Relatório de compras",
  movimentacao: "Movimentação de estoque",
  inventario: "Inventário de estoque",
  producao: "Produção e custos",
};

export function Relatorio() {
  const base = useBase();
  const local = useLocal();
  const [tipo = "fechamento", de = "", ate = ""] = local.partes;
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(de) && /^\d{4}-\d{2}-\d{2}$/.test(ate) && TITULOS[tipo];
  const deIso = valido ? inicioDoDiaIso(de) : "";
  const ateIso = valido ? fimDoDiaIso(ate) : "";
  const dados = useMemo((): Dados | null => {
    if (!base || !valido) return null;
    const livro = livroDeEstoque(base.movimentos);
    const custos = custosDosLotes(base, livro);
    return {
      compras: comprasNoPeriodo(base, deIso, ateIso),
      mov: movimentacaoNoPeriodo(base, deIso, ateIso, livro),
      inv: inventarioEm(base, ateIso, livro),
      prod: producaoNoPeriodo(base, deIso, ateIso, custos),
      pend: pendenciasFiscais(base, deIso, ateIso),
    };
  }, [base, valido, deIso, ateIso]);

  if (!base) return null;
  if (!valido || !dados) {
    return (
      <p className="lista-vazia">
        Relatório não encontrado. <a href="#/contabilidade">Voltar para Contabilidade</a>
      </p>
    );
  }
  const periodo = periodoPorExtenso(de, ate);
  const titulo = tipo === "inventario" ? `Inventário em ${data(`${ate}T12:00:00`)}` : `${TITULOS[tipo]} — ${periodo}`;
  const tudo = tipo === "fechamento";
  let n = 0;
  const secao = () => (tudo ? `${++n}. ` : "");

  return (
    <div className="relatorio-pagina">
      <div className="relatorio-barra nao-imprimir">
        <a className="botao fantasma" href="#/contabilidade">
          <ArrowLeft aria-hidden="true" />
          Contabilidade
        </a>
        <span className="relatorio-dica">No diálogo de impressão, escolha “Salvar como PDF”.</span>
        <button className="botao primario" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          Imprimir ou salvar PDF
        </button>
      </div>

      <article className="documento">
        <CabecalhoDocumento base={base} titulo={titulo} periodo={tipo === "inventario" ? `Posição no fim do dia ${data(`${ate}T12:00:00`)}` : `De ${data(`${de}T12:00:00`)} a ${data(`${ate}T12:00:00`)}`} />

        {tudo && <Resumo dados={dados} />}
        {(tudo || tipo === "compras") && <SecaoCompras numero={secao()} linhas={dados.compras} />}
        {(tudo || tipo === "movimentacao") && <SecaoMovimentacao numero={secao()} mov={dados.mov} base={base} detalhe={tipo === "movimentacao"} />}
        {(tudo || tipo === "inventario") && <SecaoInventario numero={secao()} inv={dados.inv} dia={ate} novaPagina={tudo} />}
        {(tudo || tipo === "producao") && <SecaoProducao numero={secao()} prod={dados.prod} base={base} />}
        {tudo && <SecaoPendencias numero={secao()} pend={dados.pend} />}
        <SecaoNotas numero={secao()} />
        <footer className="doc-rodape">
          Gerado em {dataEHora(new Date().toISOString())} pelo BFX Technologies ERP. Valores em reais.
        </footer>
      </article>
    </div>
  );
}

function CabecalhoDocumento({ base, titulo, periodo }: { base: BaseDados; titulo: string; periodo: string }) {
  const e = base.empresa;
  return (
    <header className="doc-cabeca">
      <div className="doc-empresa">
        <div className="doc-marca">BFX</div>
        <div>
          <strong>{e.razaoSocial || e.nome}</strong>
          <div>
            {e.cnpj ? `CNPJ ${formatarDocumento(e.cnpj)}` : "CNPJ não informado"}
            {e.inscricaoEstadual ? ` · IE ${e.inscricaoEstadual}` : ""}
            {e.municipio ? ` · ${e.municipio}` : ""}
          </div>
          <div>
            {e.regime ? ROTULOS.regime[e.regime] : "Regime não informado"}
            {e.dataTransicao ? ` · saída do MEI em ${data(`${e.dataTransicao}T12:00:00`)}` : ""}
          </div>
        </div>
      </div>
      <h1>{titulo}</h1>
      <p>{periodo}</p>
    </header>
  );
}

interface Dados {
  compras: ReturnType<typeof comprasNoPeriodo>;
  mov: ReturnType<typeof movimentacaoNoPeriodo>;
  inv: ReturnType<typeof inventarioEm>;
  prod: ReturnType<typeof producaoNoPeriodo>;
  pend: ReturnType<typeof pendenciasFiscais>;
}

function Resumo({ dados }: { dados: Dados }) {
  const total = dados.compras.reduce((a, c) => a + c.total, 0);
  const consumo = dados.mov.movimentos.filter((x) => x.movimento.tipo === "consumo_producao").reduce((a, x) => a - x.valor, 0);
  const itens = [
    { rotulo: "Compras", valor: brl(total), detalhe: plural(dados.compras.length, "compra", "compras") },
    { rotulo: "Entradas no estoque", valor: brl(dados.mov.totais.entradas), detalhe: "Compras recebidas e ajustes" },
    { rotulo: "Consumo na produção", valor: brl(consumo), detalhe: plural(dados.prod.pedaisBons, "pedal bom", "pedais bons") },
    { rotulo: "Estoque no fim", valor: brl(dados.inv.total), detalhe: plural(dados.inv.linhas.length, "item", "itens") },
  ];
  return (
    <section className="doc-secao">
      <div className="doc-resumo">
        {itens.map((i) => (
          <div key={i.rotulo}>
            <span>{i.rotulo}</span>
            <strong>{i.valor}</strong>
            <small>{i.detalhe}</small>
          </div>
        ))}
      </div>
      {dados.pend.length > 0 && <p className="doc-alerta">{plural(dados.pend.length, "pendência listada", "pendências listadas")} no fim do documento.</p>}
    </section>
  );
}

function Titulo({ numero, children, sub }: { numero: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="doc-titulo">
      <h2>
        {numero}
        {children}
      </h2>
      {sub && <p>{sub}</p>}
    </div>
  );
}

const Vazio = ({ texto }: { texto: string }) => <p className="doc-vazio">{texto}</p>;

function SecaoCompras({ numero, linhas }: { numero: string; linhas: ReturnType<typeof comprasNoPeriodo> }) {
  const soma = (f: (l: (typeof linhas)[number]) => number) => linhas.reduce((a, l) => a + f(l), 0);
  return (
    <section className="doc-secao">
      <Titulo numero={numero} sub="Compras feitas no período (pela data da compra), exceto rascunhos e canceladas.">
        Compras
      </Titulo>
      {linhas.length === 0 ? (
        <Vazio texto="Nenhuma compra no período." />
      ) : (
        <>
          <table className="doc-tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Fornecedor</th>
                <th>Documento</th>
                <th className="num">Produtos</th>
                <th className="num">Frete</th>
                <th className="num">Impostos</th>
                <th className="num">Outras</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const c = l.compra;
                return (
                  <tr key={c.id}>
                    <td className="sem-quebra">{data(c.data)}</td>
                    <td>
                      {l.fornecedor?.nome ?? "Não informado"}
                      {soDocumento(l.fornecedor?.documento) && <div className="doc-sub">{formatarDocumento(l.fornecedor!.documento)}</div>}
                    </td>
                    <td>
                      {ROTULOS.documento[c.documentoTipo]}
                      {c.numeroNF ? ` ${c.numeroNF}` : ""}
                      {c.serieNF ? `/${c.serieNF}` : ""}
                      {c.chaveNFe && <div className="doc-sub doc-chave">{formatarChave(c.chaveNFe)}</div>}
                      {c.compradoEm === "cpf" && <div className="doc-sub doc-marcado">Comprada no CPF</div>}
                      {c.legado && <div className="doc-sub">Histórico do app antigo</div>}
                      {c.status !== "recebida" && <div className="doc-sub">{ROTULOS.statusCompra[c.status]}</div>}
                    </td>
                    <td className="num">{brl(l.produtos)}</td>
                    <td className="num">{c.frete ? brl(c.frete) : "—"}</td>
                    <td className="num">{c.impostos ? brl(c.impostos) : "—"}</td>
                    <td className="num">{c.outrasDespesas ? brl(c.outrasDespesas) : "—"}</td>
                    <td className="num">{brl(l.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total · {plural(linhas.length, "compra", "compras")}</td>
                <td className="num">{brl(soma((l) => l.produtos))}</td>
                <td className="num">{brl(soma((l) => l.compra.frete || 0))}</td>
                <td className="num">{brl(soma((l) => l.compra.impostos || 0))}</td>
                <td className="num">{brl(soma((l) => l.compra.outrasDespesas || 0))}</td>
                <td className="num">{brl(soma((l) => l.total))}</td>
              </tr>
            </tfoot>
          </table>

          <h3 className="doc-subtitulo">Peças compradas</h3>
          <table className="doc-tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Peça</th>
                <th>NCM</th>
                <th className="num">Qtd</th>
                <th className="num">Valor</th>
                <th className="num">Custo unit. com rateio</th>
              </tr>
            </thead>
            <tbody>
              {linhas.flatMap((l) =>
                l.itens.map(({ item, componente, custoUnitario }) => (
                  <tr key={item.id}>
                    <td className="sem-quebra">{data(l.compra.data)}</td>
                    <td>
                      {componente?.nome ?? item.componenteId}
                      <div className="doc-sub">
                        {l.fornecedor?.nome ?? "Fornecedor não informado"}
                        {l.compra.numeroNF ? ` · NF ${l.compra.numeroNF}` : ""}
                      </div>
                    </td>
                    <td className="sem-quebra">{componente?.ncm ? formatarNCM(componente.ncm) : "—"}</td>
                    <td className="num">
                      {num(item.quantidade)} {componente?.unidade ?? ""}
                    </td>
                    <td className="num">{brl(item.valorTotal)}</td>
                    <td className="num">{brlUnit(custoUnitario)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function SecaoMovimentacao({ numero, mov, base, detalhe }: { numero: string; mov: ReturnType<typeof movimentacaoNoPeriodo>; base: BaseDados; detalhe: boolean }) {
  const componentes = mapaPorId(base.componentes);
  return (
    <section className="doc-secao">
      <Titulo numero={numero} sub="Por peça: o que havia no início, o que entrou, o que saiu e o que ficou. Valores pelo custo médio ponderado.">
        Movimentação de estoque
      </Titulo>
      {mov.linhas.length === 0 ? (
        <Vazio texto="Nenhum movimento de estoque no período." />
      ) : (
        <table className="doc-tabela doc-compacta">
          <thead>
            <tr>
              <th rowSpan={2}>Peça</th>
              <th colSpan={2} className="centro">
                Saldo inicial
              </th>
              <th colSpan={2} className="centro">
                Entradas
              </th>
              <th colSpan={2} className="centro">
                Saídas
              </th>
              <th colSpan={2} className="centro">
                Saldo final
              </th>
            </tr>
            <tr>
              <th className="num">Qtd</th>
              <th className="num">Valor</th>
              <th className="num">Qtd</th>
              <th className="num">Valor</th>
              <th className="num">Qtd</th>
              <th className="num">Valor</th>
              <th className="num">Qtd</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {mov.linhas.map((l) => (
              <tr key={l.componente.id}>
                <td>
                  {l.componente.nome}
                  <div className="doc-sub">{l.componente.categoria}</div>
                </td>
                <td className="num">{num(l.inicial.quantidade)}</td>
                <td className="num">{brl(l.inicial.valor)}</td>
                <td className="num">{l.entradas.quantidade ? num(l.entradas.quantidade) : "—"}</td>
                <td className="num">{l.entradas.quantidade ? brl(l.entradas.valor) : "—"}</td>
                <td className="num">{l.saidas.quantidade ? num(l.saidas.quantidade) : "—"}</td>
                <td className="num">{l.saidas.quantidade ? brl(l.saidas.valor) : "—"}</td>
                <td className="num">{num(l.final.quantidade)}</td>
                <td className="num">{brl(l.final.valor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td />
              <td className="num">{brl(mov.totais.inicial)}</td>
              <td />
              <td className="num">{brl(mov.totais.entradas)}</td>
              <td />
              <td className="num">{brl(mov.totais.saidas)}</td>
              <td />
              <td className="num">{brl(mov.totais.final)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {detalhe && mov.movimentos.length > 0 && (
        <>
          <h3 className="doc-subtitulo">Lançamentos do período</h3>
          <table className="doc-tabela doc-compacta">
            <thead>
              <tr>
                <th>Data</th>
                <th>Peça</th>
                <th>Tipo</th>
                <th className="num">Qtd</th>
                <th className="num">Custo unit.</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {mov.movimentos.map((x) => (
                <tr key={x.movimento.id}>
                  <td className="sem-quebra">{data(x.movimento.data)}</td>
                  <td>
                    {componentes.get(x.movimento.componenteId)?.nome ?? x.movimento.componenteId}
                    {x.movimento.obs && <div className="doc-sub">{x.movimento.obs}</div>}
                  </td>
                  <td>{ROTULOS.tipoMovimento[x.movimento.tipo]}</td>
                  <td className="num">
                    {x.movimento.quantidade > 0 ? "+" : ""}
                    {num(x.movimento.quantidade)}
                  </td>
                  <td className="num">{brlUnit(x.custoUnitario)}</td>
                  <td className="num">{brl(x.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function SecaoInventario({ numero, inv, dia, novaPagina }: { numero: string; inv: ReturnType<typeof inventarioEm>; dia: string; novaPagina: boolean }) {
  return (
    <section className={`doc-secao ${novaPagina ? "doc-quebra" : ""}`}>
      <Titulo numero={numero} sub={`Peças em estoque no fim do dia ${data(`${dia}T12:00:00`)}, valorizadas pelo custo médio ponderado de aquisição.`}>
        Inventário
      </Titulo>
      {inv.linhas.length === 0 ? (
        <Vazio texto="Nenhuma peça em estoque nesta data." />
      ) : (
        <table className="doc-tabela">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>NCM</th>
              <th>Un</th>
              <th className="num">Quantidade</th>
              <th className="num">Custo unitário</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {inv.linhas.map((l) => (
              <tr key={l.componente.id}>
                <td className="doc-codigo">{l.componente.sku || "—"}</td>
                <td>
                  {l.componente.nome}
                  {l.componente.variante && <div className="doc-sub">{l.componente.variante}</div>}
                </td>
                <td className="sem-quebra">{l.componente.ncm ? formatarNCM(l.componente.ncm) : "—"}</td>
                <td>{l.componente.unidade}</td>
                <td className={`num ${l.quantidade < 0 ? "doc-marcado" : ""}`}>{num(l.quantidade)}</td>
                <td className="num">{brlUnit(l.custoMedio)}</td>
                <td className="num">{brl(l.valor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>Total do inventário · {plural(inv.linhas.length, "item", "itens")}</td>
              <td className="num">{brl(inv.total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {inv.linhas.length > 0 && <div className="doc-assinatura">
        <div>
          <span />
          Responsável pela contagem
        </div>
        <div>
          <span />
          Data
        </div>
      </div>}
    </section>
  );
}

function SecaoProducao({ numero, prod, base }: { numero: string; prod: ReturnType<typeof producaoNoPeriodo>; base: BaseDados }) {
  const produtos = mapaPorId(base.produtos);
  return (
    <section className="doc-secao">
      <Titulo numero={numero} sub="Pedais montados no período, custos de fabricação lançados e o custo real dos lotes concluídos.">
        Produção e custos
      </Titulo>
      {prod.apontamentos.length === 0 && prod.custosFabricacao.length === 0 && prod.lotesConcluidos.length === 0 ? (
        <Vazio texto="Nenhuma produção registrada no período." />
      ) : (
        <>
          {prod.apontamentos.length > 0 && (
            <>
              <h3 className="doc-subtitulo">Pedais montados</h3>
              <table className="doc-tabela">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Lote</th>
                    <th>Modelo</th>
                    <th className="num">Bons</th>
                    <th className="num">Refugo</th>
                    <th className="num">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {prod.apontamentos.map(({ apontamento: a, produto, lote }) => (
                    <tr key={a.id}>
                      <td className="sem-quebra">{data(a.data)}</td>
                      <td>{lote?.codigo ?? "—"}</td>
                      <td>{produto?.nome ?? a.produtoId}</td>
                      <td className="num">{num(a.qtdBoa)}</td>
                      <td className="num">{num(a.qtdRefugo)}</td>
                      <td className="num">{a.horas ? num(a.horas) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total</td>
                    <td className="num">{num(prod.pedaisBons)}</td>
                    <td className="num">{num(prod.refugo)}</td>
                    <td className="num">{num(prod.apontamentos.reduce((a, x) => a + (x.apontamento.horas ?? 0), 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
          {prod.custosFabricacao.length > 0 && (
            <>
              <h3 className="doc-subtitulo">Custos de fabricação</h3>
              <table className="doc-tabela">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Lote</th>
                    <th>Tipo</th>
                    <th>Descrição</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {prod.custosFabricacao.map(({ custo: c, lote }) => (
                    <tr key={c.id}>
                      <td className="sem-quebra">{data(c.data)}</td>
                      <td>{lote?.codigo ?? "—"}</td>
                      <td>{ROTULOS.tipoCusto[c.tipo]}</td>
                      <td>
                        {c.descricao ?? "—"}
                        {c.horas ? <div className="doc-sub">{num(c.horas)} h</div> : null}
                      </td>
                      <td className="num">{brl(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Total</td>
                    <td className="num">{brl(prod.totalCustos)}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
          {prod.lotesConcluidos.length > 0 && (
            <>
              <h3 className="doc-subtitulo">Custo real dos lotes concluídos</h3>
              <table className="doc-tabela">
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Pedais</th>
                    <th className="num">Peças</th>
                    <th className="num">Mão de obra</th>
                    <th className="num">Outros</th>
                    <th className="num">Total</th>
                    <th className="num">Por pedal</th>
                  </tr>
                </thead>
                <tbody>
                  {prod.lotesConcluidos.map(({ lote, custo, itens }) => (
                    <tr key={lote.id}>
                      <td>
                        {lote.codigo}
                        <div className="doc-sub">concluído em {data(lote.concluidoEm)}</div>
                      </td>
                      <td>
                        {itens.map(({ item, produto }) => (
                          <Fragment key={item.id}>
                            {item.qtdProduzida ?? "?"}× {produto?.nome ?? produtos.get(item.produtoId)?.nome ?? item.produtoId}
                            <br />
                          </Fragment>
                        ))}
                      </td>
                      <td className="num">{brl(custo.materiais + custo.diretos)}</td>
                      <td className="num">{brl(custo.maoDeObra)}</td>
                      <td className="num">{brl(custo.outros)}</td>
                      <td className="num">{brl(custo.total)}</td>
                      <td className="num">{custo.porPedal != null ? brl(custo.porPedal) : "sem produção registrada"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
}

function SecaoPendencias({ numero, pend }: { numero: string; pend: ReturnType<typeof pendenciasFiscais> }) {
  return (
    <section className="doc-secao">
      <Titulo numero={numero} sub="Pontos em aberto no período, para conversar com o contador.">
        Pendências
      </Titulo>
      {pend.length === 0 ? (
        <Vazio texto="Nenhuma pendência no período." />
      ) : (
        <ul className="doc-lista">
          {pend.map((p) => (
            <li key={p.id}>
              <strong>
                {p.titulo}
                {p.quantidade > 1 ? ` (${p.quantidade})` : ""}
              </strong>
              <span>{p.detalhe}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SecaoNotas({ numero }: { numero: string }) {
  return (
    <section className="doc-secao doc-notas">
      <Titulo numero={numero}>Critérios usados</Titulo>
      <ul className="doc-lista">
        <li>
          <strong>Custo de aquisição.</strong>
          <span>Valor pago pelas peças, mais frete, impostos não recuperados e outras despesas da compra, divididos entre as peças na proporção do valor de cada uma.</span>
        </li>
        <li>
          <strong>Avaliação do estoque.</strong>
          <span>Custo médio ponderado móvel: cada entrada recalcula a média; as saídas usam a média vigente na data. Lançamentos com data retroativa recalculam as saídas seguintes.</span>
        </li>
        <li>
          <strong>Entrada no estoque.</strong>
          <span>Na data em que a compra foi recebida. Compras do sistema anterior estão no histórico, mas o estoque delas entrou como saldo inicial.</span>
        </li>
        <li>
          <strong>Consumo na produção.</strong>
          <span>Peças baixadas pela lista de peças (composição) de cada pedal montado, inclusive os refugados.</span>
        </li>
      </ul>
    </section>
  );
}
