import { ArrowRight, Check, ClipboardList, FileStack, FileCode2, Layers, ListChecks, Plus, ShoppingCart, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { useStatusSincronizacao } from "../backup/sincronizacao";
import { quantidadeAReceber, STATUS_EM_ABERTO, totalDaCompra } from "../data/compras";
import { useBase, useConfigProducao, useProdutos, type ProdutoDetalhe } from "../data/consultas";
import { calcularSaldos, situacao } from "../data/estoque";
import { brl, data, formatarDocumento, mesAnterior, mesDe, mesLocal, nomeDoMes, num, plural, ROTULOS } from "../data/formato";
import { fezAlgumaContagem, fezContagemDeTransicao, mapaPorId, pendenciasFiscais } from "../data/relatorios";
import { Cabecalho, Cartao, Faixa, Led, Status, Tag, type CorLed } from "../ui/base";
import { DEMO } from "../demo";
import { IconePedal } from "../ui/icones";
import { COR_LOTE } from "./comum";

function Pedal({ detalhe }: { detalhe: ProdutoDetalhe }) {
  const { produto: p, capacidade: c, custoVariavel } = detalhe;
  const [primeiro, ...outros] = c.limitantes;
  const porQuanto = primeiro && (primeiro.modo === "unidade" ? "por pedal" : "por lote");

  let limite = "A composição não tem peças que ficam no estoque.";
  if (primeiro && c.unidades === 0) {
    limite = `Falta ${primeiro.nome}${outros.length ? ` e mais ${plural(outros.length, "peça", "peças")}` : ""}.`;
  } else if (primeiro) {
    limite = `Gargalo: ${primeiro.nome} — ${num(primeiro.saldo)} em estoque, ${num(primeiro.quantidade)} ${porQuanto}.`;
  }

  return (
    <a className="pedal" href={`#/produtos/${p.id}`}>
      {p.imagem ? (
        <img className="pedal-foto" src={p.imagem} alt="" />
      ) : (
        <div className="pedal-foto vazia">
          <IconePedal width={32} height={32} strokeWidth={1.5} />
        </div>
      )}
      <div className="pedal-info">
        <div className="pedal-nome">{p.nome}</div>
        <div className="pedal-numero">
          <strong>{c.unidades ?? "—"}</strong>
          <span className="legenda">{c.unidades === 1 ? "pedal" : "pedais"}</span>
        </div>
        <div className="pedal-limite">
          <Led cor={c.unidades === null ? "apagado" : c.unidades === 0 ? "vermelho" : "verde"} />
          <span>{limite}</span>
        </div>
        <div className="pedal-meta">
          {custoVariavel > 0 && <Tag>Peças {brl(custoVariavel)} por pedal</Tag>}
          {p.precoVenda > 0 && <Tag>Venda {brl(p.precoVenda)}</Tag>}
        </div>
      </div>
    </a>
  );
}

interface Alerta {
  cor: CorLed;
  titulo: string;
  detalhe: string;
  link: string;
}

export function Painel() {
  const base = useBase();
  const produtos = useProdutos();
  const config = useConfigProducao();
  const sincronizacao = useStatusSincronizacao();

  const calc = useMemo(() => {
    if (!base) return null;
    const saldos = calcularSaldos(base.movimentos);
    const estocaveis = base.componentes.filter((c) => c.ativo && c.controlaEstoque);
    const abaixo = estocaveis.filter((c) => situacao(saldos.get(c.id)?.quantidade ?? 0, c.estoqueMinimo) !== "ok" && c.estoqueMinimo > 0);
    let valorEstoque = 0;
    for (const s of saldos.values()) valorEstoque += s.valor;
    const total = (id: string) => {
      const c = base.compras.find((x) => x.id === id)!;
      return totalDaCompra(c, base.compraItens.filter((i) => i.compraId === id));
    };
    const mes = mesDe();
    const doMes = base.compras.filter((c) => mesLocal(c.data) === mes && c.status !== "cancelada" && c.status !== "rascunho");
    const aReceber = base.compras.filter((c) => STATUS_EM_ABERTO.includes(c.status));
    return {
      valorEstoque,
      abaixo,
      comprasMes: doMes.reduce((a, c) => a + total(c.id), 0),
      qtdComprasMes: doMes.length,
      aReceber,
      valorAReceber: aReceber.reduce((a, c) => a + total(c.id), 0),
      pendencias: pendenciasFiscais(base),
    };
  }, [base]);

  if (!base || !produtos || !calc || !config) return null;
  const empresa = base.empresa;
  const lotes = mapaPorId(base.lotes);
  const ativos = base.lotes.filter((l) => l.status !== "concluido" && l.status !== "cancelado").sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  const vazio = !base.componentes.length && !base.produtos.length;

  const alertas: Alerta[] = [
    ...calc.pendencias.map((p) => ({ cor: (p.gravidade === "alta" ? "vermelho" : p.gravidade === "media" ? "ambar" : "apagado") as CorLed, titulo: p.quantidade > 1 ? `${p.titulo} (${p.quantidade})` : p.titulo, detalhe: p.detalhe, link: p.link })),
    ...(calc.abaixo.length
      ? [
          {
            cor: "ambar" as CorLed,
            titulo: `${plural(calc.abaixo.length, "peça abaixo", "peças abaixo")} do estoque mínimo`,
            detalhe: calc.abaixo
              .slice(0, 3)
              .map((c) => c.nome)
              .join(", ") + (calc.abaixo.length > 3 ? "…" : ""),
            link: "#/estoque?filtro=abaixo",
          },
        ]
      : []),
    ...(calc.aReceber.length
      ? [
          {
            cor: "laranja" as CorLed,
            titulo: `${plural(calc.aReceber.length, "compra a receber", "compras a receber")}`,
            detalhe: `${brl(calc.valorAReceber)} em pedidos. Marque como recebida quando chegar, para entrar no estoque.`,
            link: "#/compras?filtro=a_receber",
          },
        ]
      : []),
  ];

  const passos = [
    ...(DEMO ? [] : [{ feito: sincronizacao.pasta === "ativa", titulo: "Ligar a sincronização pela pasta", desc: "Uma pasta do OneDrive guarda os dados e leva para os outros computadores.", link: "#/dados" }]),
    { feito: !vazio, titulo: "Cadastrar peças e produtos", desc: "Ou importar tudo do app antigo.", link: "#/dados" },
    { feito: !!empresa.cnpj && !!empresa.regime, titulo: "Preencher os dados da empresa", desc: "CNPJ, regime e a data de saída do MEI.", link: "#/dados" },
    { feito: config.valorHora > 0, titulo: "Definir o valor da hora", desc: "Para a mão de obra entrar no custo real dos pedais.", link: "#/producao" },
    {
      feito: empresa.dataTransicao ? fezContagemDeTransicao(base) : fezAlgumaContagem(base),
      titulo: "Fazer a contagem física",
      desc: empresa.dataTransicao ? "Na data de saída do MEI: vira o saldo inicial oficial." : "Confere o estoque do app com o que está na prateleira.",
      link: "#/estoque/contagem",
    },
  ];
  const faltam = passos.filter((p) => !p.feito).length;

  return (
    <>
      <Cabecalho
        sobretitulo="Painel"
        titulo={empresa.nome}
        meta={
          <>
            {empresa.regime ? (
              <Tag>{ROTULOS.regime[empresa.regime]}</Tag>
            ) : (
              <a className="tag" href="#/dados">
                <Led cor="ambar" />
                Regime não informado
              </a>
            )}
            {empresa.cnpj && <Tag codigo>CNPJ {formatarDocumento(empresa.cnpj)}</Tag>}
            {empresa.dataTransicao && <Tag>Saída do MEI em {data(`${empresa.dataTransicao}T12:00:00`)}</Tag>}
          </>
        }
        acoes={
          <>
            <a className="botao" href="#/estoque/ajuste">
              <SlidersHorizontal aria-hidden="true" />
              Ajustar estoque
            </a>
            <a className="botao" href="#/lotes/novo">
              <Layers aria-hidden="true" />
              Novo lote
            </a>
            <a className="botao primario" href="#/compras/nova">
              <Plus aria-hidden="true" />
              Nova compra
            </a>
          </>
        }
      />

      <div className="pilha">
        <Cartao icone={IconePedal} titulo="Bancada" sub="Quantos pedais dá para montar só com o que está no estoque. Cada modelo considera o estoque inteiro.">
          {produtos.length === 0 ? (
            <p className="fraco" style={{ margin: 0 }}>
              Os pedais aparecem aqui depois que você <a href="#/produtos/novo">cadastrar um produto</a> ou <a href="#/dados">importar do app antigo</a>.
            </p>
          ) : (
            <div className="bancada">
              {produtos.map((d) => (
                <Pedal key={d.produto.id} detalhe={d} />
              ))}
              {produtos.length % 2 === 1 && <div className="pedal" aria-hidden="true" />}
            </div>
          )}
        </Cartao>

        <Faixa
          itens={[
            { rotulo: "Valor em estoque", valor: brl(calc.valorEstoque), detalhe: "Pelo custo médio das peças" },
            { rotulo: `Compras em ${nomeDoMes(mesDe()).split(" ")[0]}`, valor: brl(calc.comprasMes), detalhe: plural(calc.qtdComprasMes, "compra", "compras") },
            { rotulo: "A receber", valor: brl(calc.valorAReceber), detalhe: plural(calc.aReceber.length, "pedido em aberto", "pedidos em aberto") },
            { rotulo: "Lotes em andamento", valor: num(ativos.length), detalhe: `${plural(base.lotes.filter((l) => l.status === "concluido").length, "concluído", "concluídos")} no histórico` },
          ]}
        />

        <div className="grade grade-2">
          <Cartao icone={TriangleAlert} titulo="Atenção" sub={alertas.length ? "O que pede uma ação agora." : "Nada pendente. Tudo em dia."}>
            {alertas.length > 0 && (
              <ul className="pendencias">
                {alertas.map((a) => (
                  <li key={a.titulo}>
                    <Led cor={a.cor} />
                    <div className="pendencia-texto">
                      <a href={a.link}>{a.titulo}</a>
                      <div className="sub">{a.detalhe}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <Cartao
            icone={Layers}
            titulo="Lotes em andamento"
            sub={ativos.length ? undefined : "Nenhum lote em andamento."}
            acoes={
              <a className="botao pequeno" href="#/lotes">
                Ver lotes
              </a>
            }
          >
            {ativos.length > 0 ? (
              <div className="linhas">
                {ativos.map((l) => {
                  const itens = base.loteItens.filter((i) => i.loteId === l.id);
                  const planejados = itens.reduce((a, i) => a + i.qtdPlanejada, 0);
                  const feitos = base.apontamentos.filter((a) => a.loteId === l.id).reduce((a, x) => a + x.qtdBoa, 0);
                  const compras = base.compras.filter((c) => c.loteId === l.id);
                  const chegar = compras.reduce((a, c) => a + base.compraItens.filter((i) => i.compraId === c.id).reduce((s, i) => s + quantidadeAReceber(c, i), 0), 0);
                  return (
                    <a key={l.id} className="linha linha-link" href={`#/lotes/${l.id}`}>
                      <Tag codigo>{l.codigo}</Tag>
                      <div className="linha-texto">
                        <div className="celula-titulo">{l.nome}</div>
                        <div className="progresso" aria-label={`${feitos} de ${planejados} pedais`}>
                          <span style={{ width: `${planejados ? Math.min(100, (feitos / planejados) * 100) : 0}%` }} />
                        </div>
                        <div className="sub">
                          {num(feitos)} de {plural(planejados, "pedal", "pedais")} · {plural(compras.length, "compra", "compras")}
                          {chegar > 0 ? ` · ${plural(chegar, "peça a chegar", "peças a chegar")}` : ""}
                        </div>
                      </div>
                      <Status cor={COR_LOTE[l.status]}>{ROTULOS.statusLote[l.status]}</Status>
                    </a>
                  );
                })}
              </div>
            ) : (
              <a className="botao" href="#/lotes/novo">
                <Plus aria-hidden="true" />
                Planejar um lote
              </a>
            )}
          </Cartao>
        </div>

        <div className="grade grade-2">
          <Cartao icone={FileStack} titulo="Contabilidade" sub={`O fechamento de ${nomeDoMes(mesAnterior())} já pode ser gerado.`}>
            <div className="atalhos">
              <a className="atalho" href={`#/contabilidade`}>
                <FileStack aria-hidden="true" />
                <span>
                  <strong>Relatórios do contador</strong>
                  <span>Fechamento do mês em PDF</span>
                </span>
                <ArrowRight aria-hidden="true" />
              </a>
              <a className="atalho" href="#/compras">
                <FileCode2 aria-hidden="true" />
                <span>
                  <strong>Importar XML de nota</strong>
                  <span>Compra preenchida pela NF-e</span>
                </span>
                <ArrowRight aria-hidden="true" />
              </a>
              <a className="atalho" href="#/estoque/contagem">
                <ClipboardList aria-hidden="true" />
                <span>
                  <strong>Contagem física</strong>
                  <span>Confere estoque e gera ajustes</span>
                </span>
                <ArrowRight aria-hidden="true" />
              </a>
            </div>
          </Cartao>

          {faltam > 0 ? (
            <Cartao icone={ListChecks} titulo="Primeiros passos" sub={`Faltam ${plural(faltam, "passo", "passos")} para usar o ERP no dia a dia.`}>
              <ol className="passos">
                {passos.map((p, i) => (
                  <li key={p.titulo} className={`passo ${p.feito ? "feito" : ""}`}>
                    <span className="passo-marca">{p.feito ? <Check aria-label="Feito" /> : i + 1}</span>
                    <div className="passo-texto">
                      <div className="passo-titulo">{p.titulo}</div>
                      <div className="passo-desc">{p.desc}</div>
                    </div>
                    {!p.feito && (
                      <a className="botao pequeno" href={p.link}>
                        Fazer agora
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </Cartao>
          ) : (
            <Cartao icone={ShoppingCart} titulo="Últimas compras">
              <ul className="lista-simples">
                {[...base.compras]
                  .sort((a, b) => b.data.localeCompare(a.data))
                  .slice(0, 6)
                  .map((c) => (
                    <li key={c.id}>
                      <a href={`#/compras/${c.id}`}>{base.fornecedores.find((f) => f.id === c.fornecedorId)?.nome ?? "Sem fornecedor"}</a>
                      <span className="fraco">
                        {data(c.data)}
                        {c.loteId ? ` · ${lotes.get(c.loteId)?.codigo ?? ""}` : ""}
                      </span>
                      <span className="lista-valor">{brl(totalDaCompra(c, base.compraItens.filter((i) => i.compraId === c.id)))}</span>
                    </li>
                  ))}
              </ul>
            </Cartao>
          )}
        </div>
      </div>
    </>
  );
}
