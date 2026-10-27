import { ExternalLink, Plus, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { excluirFornecedor, salvarFornecedor, type FornecedorEditavel } from "../data/acoes";
import { totalDaCompra } from "../data/compras";
import { useBase } from "../data/consultas";
import { brl, combina, data, documentoValido, formatarDocumento, hostDe, num, plural, ROTULOS, soDocumento } from "../data/formato";
import type { BaseDados } from "../data/relatorios";
import type { Fornecedor } from "../data/tipos";
import { Cabecalho, Cartao, Faixa, Status, Tag, useFeedback } from "../ui/base";
import { AreaTexto, Busca, Campo, Filtros, Interruptor, Numero, Segmentado, Texto, useFormulario } from "../ui/form";
import { Gaveta, useExecutar } from "../ui/gaveta";
import { ir, trocarQuery, useLocal } from "../ui/rota";
import { COR_COMPRA, SemDados } from "./comum";

export function Fornecedores() {
  const base = useBase();
  const local = useLocal();
  const [busca, setBusca] = useState("");
  const filtro = local.query.get("filtro") ?? "ativos";
  const editando = local.partes[0];

  const linhas = useMemo(() => {
    if (!base) return [];
    return base.fornecedores
      .map((f) => {
        const compras = base.compras.filter((c) => c.fornecedorId === f.id && c.status !== "cancelada");
        const gasto = compras.reduce((a, c) => a + totalDaCompra(c, base.compraItens.filter((i) => i.compraId === c.id)), 0);
        const ultima = compras.reduce((m, c) => (c.data > m ? c.data : m), "");
        return { fornecedor: f, compras: compras.length, gasto, ultima, pecas: base.componenteFornecedores.filter((v) => v.fornecedorId === f.id).length };
      })
      .sort((a, b) => b.gasto - a.gasto || a.fornecedor.nome.localeCompare(b.fornecedor.nome, "pt-BR"));
  }, [base]);

  if (!base) return null;
  const ativos = linhas.filter((l) => l.fornecedor.ativo);
  const visiveis = linhas.filter((l) => {
    const f = l.fornecedor;
    if (filtro === "ativos" && !f.ativo) return false;
    if (filtro === "nacional" && (f.tipo !== "nacional" || !f.ativo)) return false;
    if (filtro === "importacao" && (f.tipo !== "importacao" || !f.ativo)) return false;
    if (filtro === "inativos" && f.ativo) return false;
    if (filtro === "sem_documento" && (soDocumento(f.documento) || f.tipo !== "nacional")) return false;
    return combina(busca, f.nome, f.documento, soDocumento(f.documento), f.pais, f.site, f.contato, f.email);
  });
  const semDoc = ativos.filter((l) => l.fornecedor.tipo === "nacional" && !soDocumento(l.fornecedor.documento)).length;

  return (
    <>
      <Cabecalho
        sobretitulo="Cadastros"
        titulo="Fornecedores"
        descricao="De quem você compra, quanto já comprou e quais peças cada um fornece."
        acoes={
          <button className="botao primario" onClick={() => ir("/fornecedores/novo")}>
            <Plus aria-hidden="true" />
            Novo fornecedor
          </button>
        }
      />
      <div className="pilha">
        {linhas.length === 0 ? (
          <SemDados titulo="Nenhum fornecedor cadastrado" icone={Truck} novo={{ rotulo: "Cadastrar fornecedor", href: "#/fornecedores/novo" }} />
        ) : (
          <>
            <Faixa
              itens={[
                { rotulo: "Fornecedores ativos", valor: num(ativos.length) },
                { rotulo: "Nacionais", valor: num(ativos.filter((l) => l.fornecedor.tipo === "nacional").length), detalhe: semDoc ? `${plural(semDoc, "sem CNPJ/CPF", "sem CNPJ/CPF")}` : "Todos com CNPJ/CPF" },
                { rotulo: "Importação", valor: num(ativos.filter((l) => l.fornecedor.tipo === "importacao").length) },
                { rotulo: "Total comprado", valor: brl(linhas.reduce((a, l) => a + l.gasto, 0)), detalhe: "Em todas as compras" },
              ]}
            />
            <Cartao className="cartao-lista">
              <div className="barra">
                <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar por nome, CNPJ, país…" />
                <Filtros
                  ativo={filtro}
                  aoMudar={(id) => trocarQuery("filtro", id === "ativos" ? undefined : id)}
                  opcoes={[
                    { id: "ativos", rotulo: "Ativos", contagem: ativos.length },
                    { id: "nacional", rotulo: "Nacionais" },
                    { id: "importacao", rotulo: "Importação" },
                    { id: "sem_documento", rotulo: "Sem CNPJ/CPF", contagem: semDoc, alerta: true },
                    { id: "inativos", rotulo: "Inativos" },
                  ]}
                />
              </div>
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Fornecedor</th>
                      <th>Tipo</th>
                      <th>CNPJ / CPF</th>
                      <th className="num">Peças</th>
                      <th className="num">Compras</th>
                      <th>Última compra</th>
                      <th className="num">Total comprado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map(({ fornecedor: f, compras, gasto, ultima, pecas }) => (
                      <tr key={f.id} className="clicavel" onClick={() => ir(`/fornecedores/${f.id}`)}>
                        <td>
                          <a className="celula-titulo link-linha" href={`#/fornecedores/${f.id}`} onClick={(e) => e.stopPropagation()}>
                            {f.nome}
                          </a>
                          <div className="sub">
                            {f.site ? hostDe(f.site) : f.pais}
                            {!f.ativo && " · inativo"}
                          </div>
                        </td>
                        <td>
                          <Tag>{ROTULOS.tipoFornecedor[f.tipo]}</Tag>
                        </td>
                        <td>
                          {soDocumento(f.documento) ? <span className="mono">{formatarDocumento(f.documento)}</span> : f.tipo === "nacional" ? <Status cor="ambar">Não informado</Status> : <span className="fraco">—</span>}
                        </td>
                        <td className="num">{num(pecas)}</td>
                        <td className="num">{num(compras)}</td>
                        <td>{ultima ? data(ultima) : <span className="fraco">—</span>}</td>
                        <td className="num">{brl(gasto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visiveis.length === 0 && <p className="lista-vazia">Nenhum fornecedor com esse filtro.</p>}
              </div>
            </Cartao>
          </>
        )}
      </div>
      {editando && <EditorFornecedor key={editando} base={base} id={editando === "novo" ? undefined : editando} aoFechar={() => ir(`/fornecedores${filtro !== "ativos" ? `?filtro=${filtro}` : ""}`)} />}
    </>
  );
}

const NOVO: FornecedorEditavel = { nome: "", tipo: "nacional", ativo: true, pais: "Brasil" };

export function EditorFornecedor({ base, id, aoFechar, aoCriar, inicial }: { base: BaseDados; id?: string; aoFechar: () => void; aoCriar?: (id: string) => void; inicial?: Partial<Fornecedor> }) {
  const existente = id ? base.fornecedores.find((f) => f.id === id) : undefined;
  const form = useFormulario<FornecedorEditavel>(existente ?? { ...NOVO, ...inicial });
  const { valores: v, mudar } = form;
  const { confirmar, avisar } = useFeedback();
  const executar = useExecutar();
  if (id && !existente) return null;

  const erroNome = form.tentou && !v.nome.trim() && "Informe o nome.";
  // Fornecedor do exterior tem documento livre (tax ID); só o nacional é conferido como CNPJ/CPF.
  const docOk = v.tipo !== "nacional" || documentoValido(v.documento);
  const erroDoc = form.tentou && !docOk && "CNPJ ou CPF inválido. Confira os números.";
  const compras = existente ? base.compras.filter((c) => c.fornecedorId === existente.id).sort((a, b) => b.data.localeCompare(a.data)) : [];
  const pecas = existente ? base.componenteFornecedores.filter((x) => x.fornecedorId === existente.id) : [];

  const salvar = async () => {
    form.setTentou(true);
    if (!v.nome.trim() || !docOk) return;
    const documento = v.tipo === "nacional" ? soDocumento(v.documento) : v.documento?.trim();
    const novoId = await salvarFornecedor({ ...v, documento: documento || undefined, site: v.site?.trim() || undefined });
    avisar(existente ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
    if (!existente && aoCriar) aoCriar(novoId);
    else aoFechar();
  };

  const excluir = async () => {
    if (!(await confirmar({ titulo: `Excluir ${existente!.nome}?`, texto: "O cadastro e os vínculos com peças serão apagados.", confirmar: "Excluir", perigo: true }))) return;
    if (await executar(() => excluirFornecedor(existente!.id), "Fornecedor excluído.")) aoFechar();
  };

  return (
    <Gaveta
      titulo={existente ? existente.nome : "Novo fornecedor"}
      sub={existente ? `Cadastrado em ${data(existente.criadoEm)}` : "Quem vende peças ou serviços para a BFX."}
      aoFechar={aoFechar}
      aoSalvar={salvar}
      sujo={form.sujo}
      rodapeEsquerda={
        existente && !compras.length ? (
          <button type="button" className="botao perigo" onClick={excluir}>
            Excluir
          </button>
        ) : undefined
      }
    >
      <div className="formulario">
        <Campo rotulo="Nome" inteiro erro={erroNome} htmlFor="f-nome">
          <Texto id="f-nome" valor={v.nome} aoMudar={(x) => mudar("nome", x)} placeholder="Razão social ou nome da loja" />
        </Campo>
        <Campo rotulo="Tipo" inteiro>
          <Segmentado
            rotulo="Tipo"
            valor={v.tipo}
            aoMudar={(x) => {
              mudar("tipo", x);
              if (x === "importacao" && (!v.pais || v.pais === "Brasil")) mudar("pais", "China");
              if (x === "nacional" && !v.pais) mudar("pais", "Brasil");
            }}
            opcoes={[
              { valor: "nacional", rotulo: "Nacional" },
              { valor: "importacao", rotulo: "Importação" },
            ]}
          />
        </Campo>
        <Campo rotulo={v.tipo === "nacional" ? "CNPJ ou CPF" : "Documento"} erro={erroDoc} opcional={v.tipo !== "nacional"} htmlFor="f-doc" dica={v.tipo === "nacional" ? "Aparece no relatório de compras do contador." : undefined}>
          <Texto id="f-doc" className="mono" valor={v.documento} aoMudar={(x) => mudar("documento", x)} onBlur={() => v.tipo === "nacional" && mudar("documento", formatarDocumento(v.documento))} placeholder={v.tipo === "nacional" ? "00.000.000/0000-00" : "Tax ID, se tiver"} />
        </Campo>
        <Campo rotulo="País" htmlFor="f-pais">
          <Texto id="f-pais" valor={v.pais} aoMudar={(x) => mudar("pais", x)} />
        </Campo>
        <Campo rotulo="Site ou loja" inteiro opcional htmlFor="f-site">
          <Texto id="f-site" valor={v.site} aoMudar={(x) => mudar("site", x)} placeholder="https://" />
        </Campo>
        <Campo rotulo="Contato" opcional htmlFor="f-contato">
          <Texto id="f-contato" valor={v.contato} aoMudar={(x) => mudar("contato", x)} />
        </Campo>
        <Campo rotulo="Telefone" opcional htmlFor="f-tel">
          <Texto id="f-tel" valor={v.telefone} aoMudar={(x) => mudar("telefone", x)} />
        </Campo>
        <Campo rotulo="E-mail" opcional htmlFor="f-email">
          <Texto id="f-email" type="email" valor={v.email} aoMudar={(x) => mudar("email", x)} />
        </Campo>
        <Campo rotulo="Prazo de entrega" opcional htmlFor="f-prazo" dica="Em dias, do pedido até chegar.">
          <Numero id="f-prazo" valor={v.prazoDias} aoMudar={(x) => mudar("prazoDias", x ?? undefined)} sufixo="dias" />
        </Campo>
        <Campo rotulo="Observações" inteiro opcional htmlFor="f-obs">
          <AreaTexto id="f-obs" valor={v.obs} aoMudar={(x) => mudar("obs", x)} />
        </Campo>
        <div className="campo-inteiro">
          <Interruptor ligado={v.ativo} aoMudar={(x) => mudar("ativo", x)} rotulo="Fornecedor ativo" descricao="Inativos somem das listas de escolha, mas o histórico fica." />
        </div>
      </div>

      {existente && (
        <div className="gaveta-secao">
          <div className="legenda">Peças que fornece</div>
          {pecas.length ? (
            <ul className="lista-simples">
              {pecas.map((x) => {
                const c = base.componentes.find((k) => k.id === x.componenteId);
                return (
                  <li key={x.id}>
                    <a href={`#/componentes/${x.componenteId}`}>{c?.nome ?? x.componenteId}</a>
                    {x.preferido && <Tag>Preferido</Tag>}
                    {x.url && (
                      <a className="link-externo" href={x.url} target="_blank" rel="noreferrer">
                        link
                        <ExternalLink aria-hidden="true" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="fraco">Nenhuma peça vinculada. Vincule no cadastro do componente.</p>
          )}
          <div className="legenda" style={{ marginTop: 22 }}>
            Compras
          </div>
          {compras.length ? (
            <ul className="lista-simples">
              {compras.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <a href={`#/compras/${c.id}`}>{data(c.data)}</a>
                  <Status cor={COR_COMPRA[c.status]}>{ROTULOS.statusCompra[c.status]}</Status>
                  <span className="lista-valor">{brl(totalDaCompra(c, base.compraItens.filter((i) => i.compraId === c.id)))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fraco">Nenhuma compra deste fornecedor.</p>
          )}
        </div>
      )}
    </Gaveta>
  );
}
