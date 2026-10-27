import { ArrowLeft, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { excluirProduto, salvarProduto, type ItemComposicaoEditavel, type ProdutoEditavel } from "../data/acoes";
import { useBase } from "../data/consultas";
import { calcularSaldos, capacidadeDeMontagem } from "../data/estoque";
import { brl, brlUnit, data, formatarNCM, pct, plural, ROTULOS, soDigitos } from "../data/formato";
import type { BaseDados } from "../data/relatorios";
import type { Componente } from "../data/tipos";
import { Cabecalho, Cartao, Faixa, Led, Tag, useFeedback } from "../ui/base";
import { Campo, Escolha, Interruptor, Moeda, Numero, Segmentado, Selecao, Texto, useFormulario } from "../ui/form";
import { useExecutar } from "../ui/gaveta";
import { IconePedal } from "../ui/icones";
import { ir, useLocal, useProtegerSaida } from "../ui/rota";
import { SemDados } from "./comum";

export function Produtos() {
  const local = useLocal();
  const base = useBase();
  if (!base) return null;
  if (local.partes[0]) return <EditorProduto key={local.partes[0]} base={base} id={local.partes[0] === "novo" ? undefined : local.partes[0]} />;
  return <ListaProdutos base={base} />;
}

// Custos de uma composição a partir do estoque atual (ou do preço de referência, sem estoque).
function custosDaComposicao(itens: ItemComposicaoEditavel[], componentes: Map<string, Componente>, custoMedio: Map<string, number>) {
  let porPedal = 0;
  let fixo = 0;
  let importado = 0;
  let comOrigem = 0;
  const linhas = itens.map((i) => {
    const c = componentes.get(i.componenteId);
    const unit = custoMedio.get(i.componenteId) || c?.custoReferencia || 0;
    const total = unit * (i.quantidade || 0);
    if (!c || c.modoCobranca === "unidade") porPedal += total;
    else fixo += total;
    if (c?.origem) {
      comOrigem += total;
      if (c.origem === "importado") importado += total;
    }
    return { item: i, componente: c, unit, total };
  });
  return { linhas, porPedal, fixo, importado, temOrigem: comOrigem > 0, semOrigem: linhas.filter((l) => l.componente?.controlaEstoque && !l.componente.origem).length };
}

// Código de origem da NF-e para produto fabricado aqui, pelo conteúdo de importação
// (valor das peças importadas ÷ preço de venda, como na FCI).
function origemSugerida(conteudo: number | null): string | null {
  if (conteudo == null) return null;
  if (conteudo === 0) return "0";
  if (conteudo <= 0.4) return "5";
  if (conteudo <= 0.7) return "3";
  return "8";
}

function ListaProdutos({ base }: { base: BaseDados }) {
  const [verInativos, setVerInativos] = useState(false);
  const saldos = useMemo(() => calcularSaldos(base.movimentos), [base.movimentos]);
  const componentes = useMemo(() => new Map(base.componentes.map((c) => [c.id, c])), [base.componentes]);
  const medio = useMemo(() => new Map([...saldos].map(([id, s]) => [id, s.custoMedio])), [saldos]);
  const produtos = base.produtos.filter((p) => verInativos || p.ativo).sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"));
  const inativos = base.produtos.filter((p) => !p.ativo).length;

  return (
    <>
      <Cabecalho
        sobretitulo="Cadastros"
        titulo="Produtos e composição"
        descricao="Cada pedal e a lista de peças que ele usa. O custo vem do custo médio do estoque ou, sem estoque, do preço de referência da peça."
        acoes={
          <>
            {inativos > 0 && (
              <button className="botao fantasma" onClick={() => setVerInativos((x) => !x)}>
                {verInativos ? "Esconder inativos" : `Mostrar ${plural(inativos, "inativo", "inativos")}`}
              </button>
            )}
            <button className="botao primario" onClick={() => ir("/produtos/novo")}>
              <Plus aria-hidden="true" />
              Novo produto
            </button>
          </>
        }
      />
      {produtos.length === 0 ? (
        <SemDados titulo="Nenhum produto cadastrado" icone={IconePedal} novo={{ rotulo: "Cadastrar produto", href: "#/produtos/novo" }} />
      ) : (
        <div className="grade grade-2">
          {produtos.map((p) => {
            const versao = base.composicoes.find((c) => c.id === p.composicaoAtualId);
            const itens = base.composicaoItens.filter((i) => i.composicaoId === p.composicaoAtualId);
            const custos = custosDaComposicao(itens, componentes, medio);
            const margem = p.precoVenda > 0 && custos.porPedal > 0 ? (p.precoVenda - custos.porPedal) / p.precoVenda : null;
            const capacidade = capacidadeDeMontagem(
              itens
                .map((i) => ({ i, c: componentes.get(i.componenteId) }))
                .filter((x) => x.c?.controlaEstoque)
                .map(({ i, c }) => ({ nome: c!.nome, quantidade: i.quantidade, modo: c!.modoCobranca, saldo: saldos.get(i.componenteId)?.quantidade ?? 0 })),
            );
            return (
              <a key={p.id} className={`cartao cartao-produto ${p.ativo ? "" : "inativo"}`} href={`#/produtos/${p.id}`}>
                <div className="produto-cabeca">
                  {p.imagem ? (
                    <img className="produto-foto" src={p.imagem} alt="" />
                  ) : (
                    <div className="produto-foto vazia">
                      <IconePedal width={28} height={28} strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="produto-titulos">
                    <h2 className="produto-nome">{p.nome}</h2>
                    <div className="produto-tags">
                      {versao && <Tag codigo>Composição v{versao.versao}</Tag>}
                      <Tag>{plural(itens.length, "peça", "peças")}</Tag>
                      {p.ncm ? <Tag codigo>NCM {formatarNCM(p.ncm)}</Tag> : <Tag><Led cor="ambar" />Sem NCM</Tag>}
                      {!p.ativo && <Tag>Inativo</Tag>}
                    </div>
                  </div>
                </div>
                <Faixa
                  itens={[
                    { rotulo: "Venda", valor: p.precoVenda ? brl(p.precoVenda) : "—", detalhe: "Por pedal" },
                    { rotulo: "Peças", valor: custos.porPedal ? brl(custos.porPedal) : "—", detalhe: custos.fixo > 0 ? `+ ${brl(custos.fixo)} fixos por lote` : "Por pedal" },
                    { rotulo: "Margem", valor: margem === null ? "—" : pct(margem), detalhe: "Sobre as peças" },
                  ]}
                />
                <div className="produto-rodape">
                  <span>
                    <Led cor={capacidade.unidades ? "verde" : capacidade.unidades === 0 ? "vermelho" : "apagado"} />
                    {capacidade.unidades == null ? "Sem peças de estoque" : `Dá para montar ${plural(capacidade.unidades, "pedal", "pedais")} com o estoque`}
                  </span>
                  <span className="produto-editar">Editar →</span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

const NOVO: ProdutoEditavel = { nome: "", precoVenda: 0, tipo: "fabricacao", ativo: true, cfop: "5101" };

// Reduz a foto para caber no banco e no backup sem pesar.
async function fotoReduzida(arquivo: File): Promise<string> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const lado = 360;
    const escala = Math.min(1, lado / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function EditorProduto({ base, id }: { base: BaseDados; id?: string }) {
  const existente = id ? base.produtos.find((p) => p.id === id) : undefined;
  const form = useFormulario<ProdutoEditavel>(existente ?? NOVO);
  const { valores: v, mudar } = form;
  const [itens, setItens] = useState<(ItemComposicaoEditavel & { chave: string })[]>(() =>
    existente
      ? base.composicaoItens
          .filter((i) => i.composicaoId === existente.composicaoAtualId)
          .map((i) => ({ i, c: base.componentes.find((c) => c.id === i.componenteId) }))
          .sort((a, b) => (a.c?.categoria ?? "").localeCompare(b.c?.categoria ?? "", "pt-BR") || (a.c?.nome ?? "").localeCompare(b.c?.nome ?? "", "pt-BR"))
          .map(({ i }) => ({ componenteId: i.componenteId, quantidade: i.quantidade, chave: i.id }))
      : [],
  );
  const [salvando, setSalvando] = useState(false);
  const entradaFoto = useRef<HTMLInputElement>(null);
  const { confirmar, avisar } = useFeedback();
  const executar = useExecutar();
  useProtegerSaida(form.sujo);

  const componentes = useMemo(() => new Map(base.componentes.map((c) => [c.id, c])), [base.componentes]);
  const medio = useMemo(() => new Map([...calcularSaldos(base.movimentos)].map(([k, s]) => [k, s.custoMedio])), [base.movimentos]);
  const custos = custosDaComposicao(itens, componentes, medio);
  const conteudoImportado = custos.temOrigem && v.precoVenda > 0 ? custos.importado / v.precoVenda : null;
  const sugestao = origemSugerida(conteudoImportado);
  const versoes = existente ? base.composicoes.filter((c) => c.produtoId === existente.id).sort((a, b) => b.versao - a.versao) : [];
  const versaoAtual = versoes.find((x) => x.id === existente?.composicaoAtualId);
  const lotesComProduto = existente ? new Set(base.loteItens.filter((i) => i.produtoId === existente.id).map((i) => i.loteId)).size : 0;

  if (id && !existente) {
    return <SemDados titulo="Produto não encontrado" icone={IconePedal} novo={{ rotulo: "Voltar aos produtos", href: "#/produtos" }} />;
  }

  const opcoesPecas = base.componentes
    .filter((c) => c.ativo || itens.some((i) => i.componenteId === c.id))
    .sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: c.variante, grupo: c.categoria }));

  const mudarItem = (i: number, parcial: Partial<ItemComposicaoEditavel>) => {
    setItens((l) => l.map((x, j) => (j === i ? { ...x, ...parcial } : x)));
    form.setSujo(true);
  };

  const voltar = async () => {
    if (form.sujo && !(await confirmar({ titulo: "Descartar alterações?", texto: "O que você mudou neste produto ainda não foi salvo.", confirmar: "Descartar", perigo: true }))) return;
    ir("/produtos");
  };

  const salvar = async () => {
    form.setTentou(true);
    if (!v.nome.trim()) return avisar("Informe o nome do produto.", true);
    if (itens.some((i) => !i.componenteId || !(i.quantidade > 0))) return avisar("Cada linha da composição precisa de uma peça e de uma quantidade.", true);
    setSalvando(true);
    const r = await executar(() => salvarProduto({ ...v, ncm: soDigitos(v.ncm) || undefined, sku: v.sku?.trim() || undefined }, itens));
    setSalvando(false);
    if (!r) return;
    form.setSujo(false);
    avisar(r.novaVersao && existente ? `Produto salvo. A composição virou a versão ${r.novaVersao}; lotes antigos mantêm a deles.` : "Produto salvo.");
    ir(`/produtos`);
  };

  const excluir = async () => {
    if (!(await confirmar({ titulo: `Excluir ${existente!.nome}?`, texto: "O produto e todas as versões da composição serão apagados.", confirmar: "Excluir", perigo: true }))) return;
    if (await executar(() => excluirProduto(existente!.id), "Produto excluído.")) ir("/produtos");
  };

  return (
    <>
      <Cabecalho
        sobretitulo="Produtos"
        titulo={existente ? v.nome || existente.nome : "Novo produto"}
        descricao={existente ? `Composição v${versaoAtual?.versao ?? "—"} · cadastrado em ${data(existente.criadoEm)}` : "Dados do pedal e a lista de peças que ele usa."}
        acoes={
          <>
            <button className="botao fantasma" onClick={voltar}>
              <ArrowLeft aria-hidden="true" />
              Produtos
            </button>
            {existente && !lotesComProduto && (
              <button className="botao perigo" onClick={excluir}>
                Excluir
              </button>
            )}
            <button className="botao primario" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar produto"}
            </button>
          </>
        }
      />
      <div className="editor">
        <div className="pilha">
          <Cartao titulo="Dados do produto">
            <div className="produto-form">
              <button type="button" className="foto-botao" onClick={() => entradaFoto.current?.click()} aria-label="Trocar foto">
                {v.imagem ? <img src={v.imagem} alt="" /> : <ImagePlus aria-hidden="true" />}
                <span>{v.imagem ? "Trocar foto" : "Pôr foto"}</span>
              </button>
              <input
                ref={entradaFoto}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) mudar("imagem", await fotoReduzida(f));
                }}
              />
              <div className="formulario">
                <Campo rotulo="Nome" erro={form.tentou && !v.nome.trim() && "Informe o nome."} htmlFor="p-nome">
                  <Texto id="p-nome" valor={v.nome} aoMudar={(x) => mudar("nome", x)} placeholder="Ex.: BFMiDi 8SW+" />
                </Campo>
                <Campo rotulo="Código (SKU)" opcional htmlFor="p-sku">
                  <Texto id="p-sku" className="mono" valor={v.sku} aoMudar={(x) => mudar("sku", x)} />
                </Campo>
                <Campo rotulo="Preço de venda" htmlFor="p-preco">
                  <Moeda id="p-preco" valor={v.precoVenda} aoMudar={(x) => mudar("precoVenda", x ?? 0)} />
                </Campo>
                <Campo rotulo="Tipo">
                  <Segmentado
                    rotulo="Tipo"
                    valor={v.tipo}
                    aoMudar={(x) => mudar("tipo", x)}
                    opcoes={[
                      { valor: "fabricacao", rotulo: "Fabricação" },
                      { valor: "revenda", rotulo: "Revenda" },
                    ]}
                  />
                </Campo>
                <div className="campo-inteiro">
                  <Interruptor ligado={v.ativo} aoMudar={(x) => mudar("ativo", x)} rotulo="Produto ativo" descricao="Inativos não aparecem na bancada nem em lotes novos." />
                </div>
              </div>
            </div>
          </Cartao>

          <Cartao
            titulo={`Composição${versaoAtual ? ` · versão ${versaoAtual.versao}` : ""}`}
            sub={lotesComProduto ? `Mudar as peças cria uma versão nova. ${plural(lotesComProduto, "lote antigo continua", "lotes antigos continuam")} com a versão que usou.` : "As peças de um pedal. Mudar a lista cria uma versão nova."}
            acoes={
              <button
                type="button"
                className="botao pequeno"
                onClick={() => {
                  setItens((l) => [...l, { componenteId: "", quantidade: 1, chave: `n${Date.now()}` }]);
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
                    <th style={{ width: "42%" }}>Peça</th>
                    <th className="num col-qtd">Qtd</th>
                    <th>Cobrança</th>
                    <th className="num">Custo unit.</th>
                    <th className="num">Custo</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {custos.linhas.map(({ item, componente, unit, total }, i) => (
                    <tr key={itens[i].chave}>
                      <td>
                        <Escolha valor={item.componenteId} aoMudar={(x) => mudarItem(i, { componenteId: x })} opcoes={opcoesPecas} placeholder="Escolha a peça" invalido={form.tentou && !item.componenteId} />
                      </td>
                      <td>
                        <Numero valor={item.quantidade} aoMudar={(x) => mudarItem(i, { quantidade: x ?? 0 })} aria-label="Quantidade" />
                      </td>
                      <td className="fraco sem-quebra">
                        {componente ? ROTULOS.modoCobranca[componente.modoCobranca] : "—"}
                        {componente && !componente.controlaEstoque && <div className="sub">não estocável</div>}
                      </td>
                      <td className="num">{unit ? brlUnit(unit) : <span className="fraco">—</span>}</td>
                      <td className="num">{total ? brl(total) : <span className="fraco">—</span>}</td>
                      <td className="acao-linha">
                        <button
                          type="button"
                          className="botao fantasma icone"
                          aria-label="Remover peça"
                          onClick={() => {
                            setItens((l) => l.filter((_, j) => j !== i));
                            form.setSujo(true);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {itens.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={4}>Peças por pedal</td>
                      <td className="num">{brl(custos.porPedal)}</td>
                      <td />
                    </tr>
                    {custos.fixo > 0 && (
                      <tr>
                        <td colSpan={4}>Fixos por modelo/lote</td>
                        <td className="num">{brl(custos.fixo)}</td>
                        <td />
                      </tr>
                    )}
                  </tfoot>
                )}
              </table>
              {itens.length === 0 && <p className="lista-vazia">Nenhuma peça ainda. Use “Adicionar peça”.</p>}
            </div>
          </Cartao>
        </div>

        <aside className="editor-lado pilha">
          <Cartao titulo="Custo e margem">
            <dl className="resumo">
              <div>
                <dt>Preço de venda</dt>
                <dd>{brl(v.precoVenda)}</dd>
              </div>
              <div>
                <dt>Peças por pedal</dt>
                <dd>{brl(custos.porPedal)}</dd>
              </div>
              {custos.fixo > 0 && (
                <div>
                  <dt>Fixos por lote</dt>
                  <dd>{brl(custos.fixo)}</dd>
                </div>
              )}
              <div className="resumo-total">
                <dt>Margem sobre as peças</dt>
                <dd>{v.precoVenda > 0 && custos.porPedal > 0 ? pct((v.precoVenda - custos.porPedal) / v.precoVenda) : "—"}</dd>
              </div>
            </dl>
            <p className="nota">Sem mão de obra e custos do lote. O custo real de cada lote aparece em Produção e custos.</p>
          </Cartao>

          <Cartao titulo="Dados fiscais" sub="Para a NF-e de venda.">
            <div className="formulario uma-coluna">
              <Campo rotulo="NCM" htmlFor="p-ncm" dica="Classificação fiscal do pedal. Confirme com o contador.">
                <Texto id="p-ncm" className="mono" valor={v.ncm} aoMudar={(x) => mudar("ncm", x)} onBlur={() => mudar("ncm", formatarNCM(v.ncm))} placeholder="0000.00.00" />
              </Campo>
              <Campo rotulo="CFOP de venda" htmlFor="p-cfop" dica="Produção própria: 5101 dentro do estado; 6101 ou 6107 para outros estados.">
                <Texto id="p-cfop" className="mono" valor={v.cfop} aoMudar={(x) => mudar("cfop", x)} />
              </Campo>
              <Campo
                rotulo="Origem da mercadoria"
                htmlFor="p-origem"
                dica={
                  conteudoImportado == null
                    ? "Com o preço de venda e a origem das peças, o app sugere o código."
                    : `Conteúdo de importação estimado: ${pct(conteudoImportado)} (peças importadas ÷ preço de venda)${custos.semOrigem ? `, com ${plural(custos.semOrigem, "peça ainda sem origem", "peças ainda sem origem")}` : ""}. Confirme com o contador.`
                }
              >
                <Selecao
                  id="p-origem"
                  valor={v.origemFiscal ?? ""}
                  aoMudar={(x) => mudar("origemFiscal", x || undefined)}
                  vazio="Não definida"
                  opcoes={Object.entries(ROTULOS.origemFiscal).map(([valor, rotulo]) => ({ valor, rotulo }))}
                />
              </Campo>
              {sugestao && sugestao !== v.origemFiscal && (
                <button type="button" className="botao pequeno" onClick={() => mudar("origemFiscal", sugestao)}>
                  Usar a sugestão ({sugestao})
                </button>
              )}
            </div>
          </Cartao>

          {versoes.length > 0 && (
            <Cartao titulo="Versões da composição">
              <ul className="lista-simples">
                {versoes.map((c) => (
                  <li key={c.id}>
                    <Tag codigo>v{c.versao}</Tag>
                    <span className="fraco">{data(c.criadaEm)}</span>
                    {c.id === existente?.composicaoAtualId && <span className="lista-valor">atual</span>}
                  </li>
                ))}
              </ul>
            </Cartao>
          )}
        </aside>
      </div>
    </>
  );
}
