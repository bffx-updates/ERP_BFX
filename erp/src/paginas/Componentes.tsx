import { Cpu, ExternalLink, Plus, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { excluirComponente, salvarComponente, salvarFornecedor, usoDoComponente, type ComponenteEditavel, type VinculoEditavel } from "../data/acoes";
import { useBase } from "../data/consultas";
import { calcularSaldos, situacao } from "../data/estoque";
import { agruparPor, brl, brlUnit, combina, data, formatarNCM, num, plural, ROTULOS, soDigitos } from "../data/formato";
import type { BaseDados } from "../data/relatorios";
import type { ModoCobranca, OrigemComponente } from "../data/tipos";
import { Cabecalho, Cartao, Faixa, Led, Status, Tag, useFeedback } from "../ui/base";
import { AreaTexto, Busca, Campo, Escolha, Filtros, Interruptor, Moeda, Numero, Segmentado, Selecao, Texto, useFormulario } from "../ui/form";
import { Gaveta, useExecutar } from "../ui/gaveta";
import { ir, trocarQuery, useLocal } from "../ui/rota";
import { SemDados } from "./comum";

export const UNIDADES = ["un", "pç", "par", "kit", "m", "cm", "kg", "g", "rolo", "pct"].map((u) => ({ valor: u, rotulo: u }));

export function Componentes() {
  const base = useBase();
  const local = useLocal();
  const [busca, setBusca] = useState("");
  const filtro = local.query.get("filtro") ?? "ativos";
  const editando = local.partes[0];

  const linhas = useMemo(() => {
    if (!base) return [];
    const saldos = calcularSaldos(base.movimentos);
    return base.componentes
      .map((c) => {
        const saldo = saldos.get(c.id) ?? { quantidade: 0, custoMedio: 0, valor: 0 };
        const vinculos = base.componenteFornecedores.filter((v) => v.componenteId === c.id);
        const pref = vinculos.find((v) => v.preferido) ?? vinculos[0];
        return {
          componente: c,
          saldo,
          situacao: situacao(saldo.quantidade, c.estoqueMinimo),
          fornecedor: pref ? base.fornecedores.find((f) => f.id === pref.fornecedorId) : undefined,
        };
      })
      .sort((a, b) => a.componente.categoria.localeCompare(b.componente.categoria, "pt-BR") || a.componente.nome.localeCompare(b.componente.nome, "pt-BR"));
  }, [base]);

  if (!base) return null;
  const ativos = linhas.filter((l) => l.componente.ativo);
  const estocaveis = ativos.filter((l) => l.componente.controlaEstoque);
  const semNcm = estocaveis.filter((l) => !l.componente.ncm).length;
  const semOrigem = estocaveis.filter((l) => !l.componente.origem).length;
  const abaixo = estocaveis.filter((l) => l.situacao !== "ok").length;

  const visiveis = linhas.filter(({ componente: c, situacao: s }) => {
    if (filtro === "inativos") {
      if (c.ativo) return false;
    } else if (!c.ativo) return false;
    if (filtro === "sem_ncm" && (!c.controlaEstoque || c.ncm)) return false;
    if (filtro === "sem_origem" && (!c.controlaEstoque || c.origem)) return false;
    if (filtro === "abaixo" && (!c.controlaEstoque || s === "ok")) return false;
    return combina(busca, c.nome, c.variante, c.categoria, c.sku, c.ncm);
  });
  const grupos = agruparPor(visiveis, (l) => l.componente.categoria);

  return (
    <>
      <Cabecalho
        sobretitulo="Cadastros"
        titulo="Componentes"
        descricao="As peças que entram nos pedais, com NCM, origem, forma de cobrança e fornecedores."
        acoes={
          <button className="botao primario" onClick={() => ir("/componentes/novo")}>
            <Plus aria-hidden="true" />
            Novo componente
          </button>
        }
      />
      <div className="pilha">
        {linhas.length === 0 ? (
          <SemDados titulo="Nenhum componente cadastrado" icone={Cpu} novo={{ rotulo: "Cadastrar componente", href: "#/componentes/novo" }} />
        ) : (
          <>
            <Faixa
              itens={[
                { rotulo: "Componentes ativos", valor: num(ativos.length), detalhe: `em ${plural(new Set(ativos.map((l) => l.componente.categoria)).size, "categoria", "categorias")}` },
                { rotulo: "Sem NCM", valor: num(semNcm), detalhe: semNcm ? "Preencha para o inventário" : "Todos classificados" },
                { rotulo: "Sem origem fiscal", valor: num(semOrigem), detalhe: semOrigem ? "Nacional ou importado?" : "Todos definidos" },
                { rotulo: "Abaixo do mínimo", valor: num(abaixo), detalhe: abaixo ? "Zerados ou no limite" : "Estoque em dia" },
              ]}
            />
            <Cartao className="cartao-lista">
              <div className="barra">
                <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar por nome, categoria, NCM…" />
                <Filtros
                  ativo={filtro}
                  aoMudar={(id) => trocarQuery("filtro", id === "ativos" ? undefined : id)}
                  opcoes={[
                    { id: "ativos", rotulo: "Ativos", contagem: ativos.length },
                    { id: "sem_ncm", rotulo: "Sem NCM", contagem: semNcm, alerta: true },
                    { id: "sem_origem", rotulo: "Sem origem", contagem: semOrigem, alerta: true },
                    { id: "abaixo", rotulo: "Abaixo do mínimo", contagem: abaixo, alerta: true },
                    { id: "inativos", rotulo: "Inativos" },
                  ]}
                />
              </div>
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Componente</th>
                      <th>NCM</th>
                      <th>Origem</th>
                      <th>Cobrança</th>
                      <th>Fornecedor preferido</th>
                      <th className="num">Saldo</th>
                      <th className="num">Custo médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupos.map(([categoria, itens]) => (
                      <Fragment key={categoria}>
                        <tr className="grupo">
                          <td colSpan={7}>
                            <span className="legenda grupo-nome">{categoria}</span>
                            <span className="grupo-conta">{itens.length}</span>
                          </td>
                        </tr>
                        {itens.map(({ componente: c, saldo, situacao: s, fornecedor }) => (
                          <tr key={c.id} className="clicavel" onClick={() => ir(`/componentes/${c.id}`)}>
                            <td>
                              <a className="celula-titulo link-linha" href={`#/componentes/${c.id}`} onClick={(e) => e.stopPropagation()}>
                                {c.nome}
                              </a>
                              <div className="sub">{[c.variante, c.sku && `SKU ${c.sku}`].filter(Boolean).join(" · ")}</div>
                            </td>
                            <td>
                              {c.ncm ? <span className="mono">{formatarNCM(c.ncm)}</span> : c.controlaEstoque ? <Status cor="ambar">Falta</Status> : <span className="fraco">—</span>}
                            </td>
                            <td>
                              {!c.controlaEstoque ? (
                                <Tag title="Custo lançado na composição; não entra no estoque">Não estocável</Tag>
                              ) : c.origem ? (
                                <Tag>{ROTULOS.origem[c.origem]}</Tag>
                              ) : (
                                <Status cor="ambar">A definir</Status>
                              )}
                            </td>
                            <td className="fraco">{ROTULOS.modoCobranca[c.modoCobranca]}</td>
                            <td>{fornecedor?.nome ?? <span className="fraco">—</span>}</td>
                            <td className="num">
                              {c.controlaEstoque ? (
                                <span className="saldo-celula">
                                  {s !== "ok" && <Led cor={s === "zerado" ? "vermelho" : "ambar"} />}
                                  {num(saldo.quantidade)} <span className="fraco">{c.unidade}</span>
                                </span>
                              ) : (
                                <span className="fraco">—</span>
                              )}
                            </td>
                            <td className="num">{saldo.custoMedio ? brlUnit(saldo.custoMedio) : <span className="fraco">—</span>}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {visiveis.length === 0 && <p className="lista-vazia">Nenhum componente com esse filtro.</p>}
              </div>
            </Cartao>
          </>
        )}
      </div>
      {editando && (
        <EditorComponente key={editando} base={base} id={editando === "novo" ? undefined : editando} aoFechar={() => ir(`/componentes${filtro !== "ativos" ? `?filtro=${filtro}` : ""}`)} />
      )}
    </>
  );
}

const NOVO: ComponenteEditavel = {
  nome: "",
  categoria: "",
  unidade: "un",
  estoqueMinimo: 0,
  modoCobranca: "unidade",
  controlaEstoque: true,
  ativo: true,
};

const MODOS: { valor: ModoCobranca; rotulo: string; detalhe: string }[] = [
  { valor: "unidade", rotulo: "Por unidade", detalhe: "Cada pedal usa a quantidade da composição (ex.: 8 chaves por pedal)." },
  { valor: "modelo", rotulo: "Fixo por modelo", detalhe: "Uma vez por modelo em cada lote, não importa quantos pedais (ex.: um painel de PCBs)." },
  { valor: "lote", rotulo: "Fixo por lote", detalhe: "Uma vez por lote, dividido entre todos os pedais (ex.: estêncil, ferramental)." },
];

export function EditorComponente({ base, id, aoFechar, aoCriar }: { base: BaseDados; id?: string; aoFechar: () => void; aoCriar?: (id: string) => void }) {
  const existente = id ? base.componentes.find((c) => c.id === id) : undefined;
  const form = useFormulario<ComponenteEditavel>(existente ?? NOVO);
  const [vinculos, setVinculos] = useState<VinculoEditavel[]>(() => (existente ? base.componenteFornecedores.filter((v) => v.componenteId === existente.id).map((v) => ({ ...v })) : []));
  const { valores: v, mudar } = form;
  const { confirmar, avisar } = useFeedback();
  const executar = useExecutar();
  const categorias = useMemo(() => [...new Set(base.componentes.map((c) => c.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR")), [base.componentes]);
  const [categoriaNova, setCategoriaNova] = useState<string>();

  const saldo = existente ? calcularSaldos(base.movimentos.filter((m) => m.componenteId === existente.id)).get(existente.id) : undefined;
  const ultimos = existente
    ? base.movimentos
        .filter((m) => m.componenteId === existente.id)
        .sort((a, b) => b.data.localeCompare(a.data))
        .slice(0, 5)
    : [];
  const usadoEm = existente
    ? base.produtos.filter((p) => base.composicaoItens.some((ci) => ci.componenteId === existente.id && ci.composicaoId === p.composicaoAtualId))
    : [];

  if (id && !existente) return null;
  const ncmDigitos = soDigitos(v.ncm);
  const erroNome = form.tentou && !v.nome.trim() && "Informe o nome.";
  const erroNcm = form.tentou && ncmDigitos.length > 0 && ncmDigitos.length !== 8 && "O NCM tem 8 dígitos.";

  const mudarVinculo = (i: number, parcial: Partial<VinculoEditavel>) => {
    setVinculos((lista) => lista.map((x, j) => (j === i ? { ...x, ...parcial } : parcial.preferido ? { ...x, preferido: false } : x)));
    form.setSujo(true);
  };

  const salvar = async () => {
    form.setTentou(true);
    if (!v.nome.trim() || (ncmDigitos.length > 0 && ncmDigitos.length !== 8)) return;
    const novoId = await salvarComponente({ ...v, ncm: ncmDigitos || undefined, sku: v.sku?.trim() || undefined, variante: v.variante?.trim() || undefined }, vinculos);
    avisar(existente ? "Componente atualizado." : "Componente cadastrado.");
    if (!existente && aoCriar) aoCriar(novoId);
    else aoFechar();
  };

  const excluir = async () => {
    const uso = await usoDoComponente(existente!.id);
    if (uso.movimentos || uso.compras || uso.produtos) {
      avisar("Este componente tem histórico. Desligue “Componente ativo” para escondê-lo das listas.", true);
      return;
    }
    if (!(await confirmar({ titulo: `Excluir ${existente!.nome}?`, texto: "O cadastro será apagado.", confirmar: "Excluir", perigo: true }))) return;
    if (await executar(() => excluirComponente(existente!.id), "Componente excluído.")) aoFechar();
  };

  const opcoesFornecedor = base.fornecedores.filter((f) => f.ativo).map((f) => ({ valor: f.id, rotulo: f.nome, detalhe: ROTULOS.tipoFornecedor[f.tipo] }));
  const opcoesCategoria = [...new Set([...categorias, ...(categoriaNova ? [categoriaNova] : [])])].map((c) => ({ valor: c, rotulo: c }));

  return (
    <Gaveta
      titulo={existente ? existente.nome : "Novo componente"}
      sub={existente ? [existente.categoria, existente.variante].filter(Boolean).join(" · ") : "Uma peça ou insumo dos pedais."}
      aoFechar={aoFechar}
      aoSalvar={salvar}
      sujo={form.sujo}
      larga
      rodapeEsquerda={
        existente ? (
          <button type="button" className="botao perigo" onClick={excluir}>
            Excluir
          </button>
        ) : undefined
      }
    >
      {existente && saldo && (
        <div className="gaveta-resumo">
          <div>
            <div className="legenda">Saldo</div>
            <strong>
              {num(saldo.quantidade)} {existente.unidade}
            </strong>
          </div>
          <div>
            <div className="legenda">Custo médio</div>
            <strong>{brlUnit(saldo.custoMedio)}</strong>
          </div>
          <div>
            <div className="legenda">Valor</div>
            <strong>{brl(saldo.valor)}</strong>
          </div>
          <a className="botao pequeno" href={`#/estoque/ficha/${existente.id}`}>
            Ficha de estoque
          </a>
        </div>
      )}

      <div className="formulario">
        <Campo rotulo="Nome" erro={erroNome} htmlFor="c-nome">
          <Texto id="c-nome" valor={v.nome} aoMudar={(x) => mudar("nome", x)} placeholder="Ex.: Chave SPST" />
        </Campo>
        <Campo rotulo="Variante ou especificação" opcional htmlFor="c-var">
          <Texto id="c-var" valor={v.variante} aoMudar={(x) => mudar("variante", x)} placeholder="Ex.: DC-005 2,1 mm" />
        </Campo>
        <Campo rotulo="Categoria" htmlFor="c-cat">
          <Escolha
            id="c-cat"
            valor={v.categoria}
            aoMudar={(x) => mudar("categoria", x)}
            opcoes={opcoesCategoria}
            placeholder="Escolha ou digite uma nova"
            aoCriar={(t) => {
              setCategoriaNova(t);
              mudar("categoria", t);
            }}
            rotuloCriar="Nova categoria"
          />
        </Campo>
        <Campo rotulo="Código interno (SKU)" opcional htmlFor="c-sku">
          <Texto id="c-sku" className="mono" valor={v.sku} aoMudar={(x) => mudar("sku", x)} />
        </Campo>
        <Campo rotulo="NCM" erro={erroNcm} htmlFor="c-ncm" dica="8 dígitos. Está na nota do fornecedor.">
          <Texto id="c-ncm" className="mono" valor={v.ncm} aoMudar={(x) => mudar("ncm", x)} onBlur={() => mudar("ncm", formatarNCM(v.ncm))} placeholder="0000.00.00" inputMode="numeric" />
        </Campo>
        <Campo rotulo="Origem">
          <Segmentado<"" | OrigemComponente>
            rotulo="Origem"
            valor={v.origem ?? ""}
            aoMudar={(x) => mudar("origem", x || undefined)}
            opcoes={[
              { valor: "nacional", rotulo: "Nacional" },
              { valor: "importado", rotulo: "Importado" },
              { valor: "", rotulo: "A definir" },
            ]}
          />
        </Campo>
        <Campo rotulo="Unidade" htmlFor="c-un">
          <Selecao id="c-un" valor={v.unidade} aoMudar={(x) => mudar("unidade", x)} opcoes={UNIDADES.some((u) => u.valor === v.unidade) ? UNIDADES : [...UNIDADES, { valor: v.unidade, rotulo: v.unidade }]} />
        </Campo>
        <Campo rotulo="Estoque mínimo" htmlFor="c-min" dica="Abaixo disso, o painel avisa.">
          <Numero id="c-min" valor={v.estoqueMinimo} aoMudar={(x) => mudar("estoqueMinimo", x ?? 0)} sufixo={v.unidade} />
        </Campo>
        <Campo rotulo="Custo de referência" opcional htmlFor="c-ref" dica="Usado no planejamento até a primeira compra.">
          <Moeda id="c-ref" casas={4} valor={v.custoReferencia} aoMudar={(x) => mudar("custoReferencia", x ?? undefined)} />
        </Campo>
        <Campo rotulo="Como entra no custo do pedal" inteiro dica={MODOS.find((m) => m.valor === v.modoCobranca)?.detalhe}>
          <Segmentado rotulo="Cobrança" valor={v.modoCobranca} aoMudar={(x) => mudar("modoCobranca", x)} opcoes={MODOS} />
        </Campo>
        <div className="campo-inteiro">
          <Interruptor
            ligado={v.controlaEstoque}
            aoMudar={(x) => mudar("controlaEstoque", x)}
            rotulo="Controla estoque"
            descricao="Desligue para custos que não são peças físicas, como frete lançado na composição."
          />
        </div>
      </div>

      <div className="gaveta-secao">
        <div className="secao-cabeca">
          <div className="legenda">Fornecedores</div>
          <button
            type="button"
            className="botao pequeno"
            onClick={() => {
              setVinculos((l) => [...l, { fornecedorId: "", preferido: l.length === 0 }]);
              form.setSujo(true);
            }}
          >
            <Plus aria-hidden="true" />
            Adicionar
          </button>
        </div>
        {vinculos.length === 0 && <p className="fraco">Nenhum fornecedor vinculado. O preferido é sugerido nos pedidos de compra dos lotes.</p>}
        <div className="vinculos">
          {vinculos.map((x, i) => (
            <div key={x.id ?? `novo-${i}`} className="vinculo">
              <div className="vinculo-linha">
                <Escolha
                  valor={x.fornecedorId}
                  aoMudar={(f) => mudarVinculo(i, { fornecedorId: f })}
                  opcoes={opcoesFornecedor}
                  placeholder="Fornecedor"
                  aoCriar={async (nome) => {
                    const novo = await salvarFornecedor({ nome, tipo: "nacional", ativo: true, pais: "Brasil" });
                    mudarVinculo(i, { fornecedorId: novo });
                    avisar(`Fornecedor “${nome}” cadastrado. Complete o CNPJ depois em Fornecedores.`);
                  }}
                  rotuloCriar="Cadastrar"
                  invalido={form.tentou && !x.fornecedorId}
                />
                <Moeda valor={x.precoRef} casas={4} aoMudar={(p) => mudarVinculo(i, { precoRef: p ?? undefined })} placeholder="Preço" aria-label="Preço de referência" />
                <label className="radio" title="Fornecedor preferido">
                  <input type="radio" name="preferido" checked={x.preferido} onChange={() => mudarVinculo(i, { preferido: true })} />
                  Preferido
                </label>
                <button
                  type="button"
                  className="botao fantasma icone"
                  aria-label="Remover fornecedor"
                  onClick={() => {
                    setVinculos((l) => l.filter((_, j) => j !== i));
                    form.setSujo(true);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
              <div className="vinculo-link">
                <Texto valor={x.url} aoMudar={(u) => mudarVinculo(i, { url: u || undefined })} placeholder="Link do produto na loja (opcional)" aria-label="Link do produto" />
                {x.url && (
                  <a className="botao fantasma icone" href={x.url} target="_blank" rel="noreferrer" aria-label="Abrir link">
                    <ExternalLink aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="formulario" style={{ marginTop: 22 }}>
        <Campo rotulo="Observações" inteiro opcional htmlFor="c-obs">
          <AreaTexto id="c-obs" valor={v.obs} aoMudar={(x) => mudar("obs", x)} />
        </Campo>
        <div className="campo-inteiro">
          <Interruptor ligado={v.ativo} aoMudar={(x) => mudar("ativo", x)} rotulo="Componente ativo" descricao="Inativos somem das listas de escolha, mas o histórico fica." />
        </div>
      </div>

      {existente && (usadoEm.length > 0 || ultimos.length > 0) && (
        <div className="gaveta-secao">
          {usadoEm.length > 0 && (
            <>
              <div className="legenda">Usado em</div>
              <div className="produto-tags" style={{ marginBottom: 18 }}>
                {usadoEm.map((p) => (
                  <a key={p.id} className="tag" href={`#/produtos/${p.id}`}>
                    {p.nome}
                  </a>
                ))}
              </div>
            </>
          )}
          {ultimos.length > 0 && (
            <>
              <div className="legenda">Últimos movimentos</div>
              <ul className="lista-simples">
                {ultimos.map((m) => (
                  <li key={m.id}>
                    <span>{data(m.data)}</span>
                    <span className="fraco">{ROTULOS.tipoMovimento[m.tipo]}</span>
                    <span className={`lista-valor ${m.quantidade < 0 ? "negativo" : "positivo"}`}>
                      {m.quantidade > 0 ? "+" : ""}
                      {num(m.quantidade)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Gaveta>
  );
}
