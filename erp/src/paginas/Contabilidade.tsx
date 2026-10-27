import { Boxes, Building2, ClipboardCheck, FileStack, Package, ShoppingCart, Wrench, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useBase } from "../data/consultas";
import { livroDeEstoque } from "../data/estoque";
import { brl, data, fimDoDiaIso, formatarDocumento, inicioDoDiaIso, limitesDoMes, mesAnterior, mesDe, mesLocal, nomeDoMes, num, periodoPorExtenso, plural, ROTULOS } from "../data/formato";
import { comprasNoPeriodo, inventarioEm, movimentacaoNoPeriodo, pendenciasFiscais, producaoNoPeriodo } from "../data/relatorios";
import { Cabecalho, Cartao, Led, Tag } from "../ui/base";
import { Campo, Data, Segmentado, Selecao } from "../ui/form";
import { useLocal } from "../ui/rota";

type Modo = "mes" | "ano" | "periodo";

const GRAVIDADE = { alta: "vermelho", media: "ambar", baixa: "apagado" } as const;

export function Contabilidade() {
  const base = useBase();
  const local = useLocal();
  const [modo, setModo] = useState<Modo>((local.query.get("modo") as Modo) ?? "mes");
  const [mes, setMes] = useState(mesAnterior());
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [de, setDe] = useState(limitesDoMes(mesDe()).de);
  const [ate, setAte] = useState(limitesDoMes(mesDe()).ate);

  const periodo = modo === "mes" ? limitesDoMes(mes) : modo === "ano" ? { de: `${ano}-01-01`, ate: `${ano}-12-31` } : { de, ate: ate < de ? de : ate };
  const deIso = inicioDoDiaIso(periodo.de);
  const ateIso = fimDoDiaIso(periodo.ate);
  const nome = periodoPorExtenso(periodo.de, periodo.ate);

  const resumo = useMemo(() => {
    if (!base) return null;
    const livro = livroDeEstoque(base.movimentos);
    const compras = comprasNoPeriodo(base, deIso, ateIso);
    const mov = movimentacaoNoPeriodo(base, deIso, ateIso, livro);
    const inv = inventarioEm(base, ateIso, livro);
    const prod = producaoNoPeriodo(base, deIso, ateIso);
    const pend = pendenciasFiscais(base, deIso, ateIso);
    return { compras, mov, inv, prod, pend };
  }, [base, deIso, ateIso]);

  if (!base || !resumo) return null;
  const meses = [...new Set([mesDe(), mesAnterior(), ...base.compras.map((c) => mesLocal(c.data)), ...base.movimentos.map((m) => mesLocal(m.data))])].sort().reverse();
  const anos = [...new Set([String(new Date().getFullYear()), ...meses.map((m) => m.slice(0, 4))])].sort().reverse();
  const link = (tipo: string) => `#/relatorio/${tipo}/${periodo.de}/${periodo.ate}`;
  const e = base.empresa;
  const totalCompras = resumo.compras.reduce((a, c) => a + c.total, 0);

  const relatorios: { tipo: string; titulo: string; desc: string; icone: LucideIcon; numero: string; detalhe: string }[] = [
    {
      tipo: "compras",
      titulo: "Compras do período",
      desc: "Cada compra com fornecedor, CNPJ, nota, chave de acesso, frete, impostos e total; depois as peças de cada uma.",
      icone: ShoppingCart,
      numero: brl(totalCompras),
      detalhe: plural(resumo.compras.length, "compra", "compras"),
    },
    {
      tipo: "movimentacao",
      titulo: "Movimentação de estoque",
      desc: "Saldo inicial, entradas, saídas e saldo final de cada peça, em quantidade e valor.",
      icone: Boxes,
      numero: brl(resumo.mov.totais.final),
      detalhe: `entradas ${brl(resumo.mov.totais.entradas)} · saídas ${brl(resumo.mov.totais.saidas)}`,
    },
    {
      tipo: "inventario",
      titulo: `Inventário em ${data(`${periodo.ate}T12:00:00`)}`,
      desc: "Posição do estoque no último dia, valorizada pelo custo médio. Base do Livro Registro de Inventário.",
      icone: Package,
      numero: brl(resumo.inv.total),
      detalhe: plural(resumo.inv.linhas.length, "item com saldo", "itens com saldo"),
    },
    {
      tipo: "producao",
      titulo: "Produção e custos",
      desc: "Pedais montados, refugo, horas, custos de fabricação e o custo real dos lotes concluídos.",
      icone: Wrench,
      numero: plural(resumo.prod.pedaisBons, "pedal", "pedais"),
      detalhe: `${brl(resumo.prod.totalCustos)} em custos de fabricação`,
    },
  ];

  return (
    <>
      <Cabecalho
        sobretitulo="Gestão"
        titulo="Contabilidade"
        descricao="Relatórios prontos para o contador. Escolha o período, abra e use Imprimir → Salvar como PDF."
      />
      <div className="pilha">
        <Cartao>
          <div className="periodo">
            <Segmentado
              rotulo="Período"
              valor={modo}
              aoMudar={setModo}
              opcoes={[
                { valor: "mes", rotulo: "Mês" },
                { valor: "ano", rotulo: "Ano" },
                { valor: "periodo", rotulo: "Outro período" },
              ]}
            />
            {modo === "mes" && (
              <div className="periodo-campo">
                <Selecao valor={mes} aoMudar={setMes} opcoes={meses.map((m) => ({ valor: m, rotulo: nomeDoMes(m) }))} />
              </div>
            )}
            {modo === "ano" && (
              <div className="periodo-campo">
                <Selecao valor={ano} aoMudar={setAno} opcoes={anos.map((a) => ({ valor: a, rotulo: a }))} />
              </div>
            )}
            {modo === "periodo" && (
              <>
                <div className="periodo-campo">
                  <Campo rotulo="De">
                    <Data valor={de} aoMudar={(x) => x && setDe(x)} />
                  </Campo>
                </div>
                <div className="periodo-campo">
                  <Campo rotulo="Até">
                    <Data valor={ate} aoMudar={(x) => x && setAte(x)} />
                  </Campo>
                </div>
              </>
            )}
            <div className="periodo-nome">
              <span className="legenda">Período</span>
              <strong>{nome}</strong>
            </div>
          </div>
        </Cartao>

        <a className="cartao fechamento" href={link("fechamento")}>
          <span className="fechamento-icone" aria-hidden="true">
            <FileStack />
          </span>
          <span className="fechamento-texto">
            <span className="sobretitulo">Para mandar ao contador</span>
            <strong>Fechamento de {nome}</strong>
            <span>Tudo num documento só: resumo, compras, movimentação, inventário, produção, pendências e notas sobre os critérios de custo.</span>
          </span>
          <span className="botao primario">Abrir fechamento</span>
        </a>

        <div className="grade grade-2">
          {relatorios.map((r) => {
            const Icone = r.icone;
            return (
              <a key={r.tipo} className="cartao relatorio-cartao" href={link(r.tipo)}>
                <div className="cartao-cabeca">
                  <span className="cartao-icone" aria-hidden="true">
                    <Icone />
                  </span>
                  <div className="cartao-titulos">
                    <h2 className="cartao-titulo">{r.titulo}</h2>
                    <p className="cartao-sub">{r.desc}</p>
                  </div>
                </div>
                <div className="relatorio-rodape">
                  <div>
                    <div className="relatorio-numero">{r.numero}</div>
                    <div className="sub">{r.detalhe}</div>
                  </div>
                  <span className="produto-editar">Abrir →</span>
                </div>
              </a>
            );
          })}
        </div>

        <div className="grade grade-2">
          <Cartao
            icone={ClipboardCheck}
            titulo="Antes de mandar"
            sub={resumo.pend.length ? "O que o contador provavelmente vai perguntar. Resolva o que der; o resto vai listado no fechamento." : "Nada pendente neste período."}
          >
            {resumo.pend.length > 0 && (
              <ul className="pendencias">
                {resumo.pend.map((p) => (
                  <li key={p.id}>
                    <Led cor={GRAVIDADE[p.gravidade]} />
                    <div className="pendencia-texto">
                      <a href={p.link}>
                        {p.titulo}
                        {p.quantidade > 1 && <span className="filtro-conta">{p.quantidade}</span>}
                      </a>
                      <div className="sub">{p.detalhe}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <Cartao icone={Building2} titulo="Cabeçalho dos relatórios" sub="Sai no topo de cada documento.">
            <dl className="resumo">
              <div>
                <dt>Empresa</dt>
                <dd>{e.razaoSocial || e.nome}</dd>
              </div>
              <div>
                <dt>CNPJ</dt>
                <dd className="mono">{e.cnpj ? formatarDocumento(e.cnpj) : <Tag><Led cor="ambar" />Falta</Tag>}</dd>
              </div>
              <div>
                <dt>Regime</dt>
                <dd>{e.regime ? ROTULOS.regime[e.regime] : <Tag><Led cor="ambar" />Falta</Tag>}</dd>
              </div>
              <div>
                <dt>Saída do MEI</dt>
                <dd>{e.dataTransicao ? data(`${e.dataTransicao}T12:00:00`) : "—"}</dd>
              </div>
              <div>
                <dt>Contador</dt>
                <dd>{e.contador || "—"}</dd>
              </div>
            </dl>
            <div className="rodape-form">
              <a className="botao pequeno" href="#/dados">
                Editar dados da empresa
              </a>
            </div>
          </Cartao>
        </div>
        <p className="nota" style={{ textAlign: "center" }}>
          {num(base.compras.length)} compras, {num(base.movimentos.length)} movimentos de estoque e {num(base.apontamentos.length)} registros de produção no total.
        </p>
      </div>
    </>
  );
}
