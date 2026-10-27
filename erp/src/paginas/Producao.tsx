import { Calculator, Settings2, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { salvarConfigProducao } from "../data/acoes";
import { useBase, useConfigProducao } from "../data/consultas";
import { calcularSaldos } from "../data/estoque";
import { anoLocal, brl, data, num, pct, plural, ROTULOS } from "../data/formato";
import { composicaoDoItem } from "../data/lotes";
import { custosDosLotes, mapaPorId } from "../data/relatorios";
import { Cabecalho, Cartao, Faixa, Status, Tag, useFeedback } from "../ui/base";
import { Campo, Moeda, Numero } from "../ui/form";
import { ir } from "../ui/rota";
import { COR_LOTE } from "./comum";

export function Producao() {
  const base = useBase();
  const config = useConfigProducao();
  const [valorHora, setValorHora] = useState<number | null>(null);
  const [margem, setMargem] = useState<number | null>(null);
  const { avisar } = useFeedback();
  useEffect(() => {
    if (config) {
      setValorHora(config.valorHora || null);
      setMargem(config.margemPadrao);
    }
  }, [config]);
  const custos = useMemo(() => (base ? custosDosLotes(base) : new Map()), [base]);
  if (!base || !config) return null;

  const produtos = mapaPorId(base.produtos);
  const componentes = mapaPorId(base.componentes);
  const medio = new Map([...calcularSaldos(base.movimentos)].map(([k, s]) => [k, s.custoMedio]));
  const ano = String(new Date().getFullYear());
  const apsAno = base.apontamentos.filter((a) => anoLocal(a.data) === ano);
  const bons = apsAno.reduce((a, x) => a + x.qtdBoa, 0);
  const refugo = apsAno.reduce((a, x) => a + x.qtdRefugo, 0);
  const horas = apsAno.reduce((a, x) => a + (x.horas ?? 0), 0);
  const lotes = base.lotes
    .filter((l) => base.apontamentos.some((a) => a.loteId === l.id) || base.custosFabricacao.some((c) => c.loteId === l.id))
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  const comCusto = lotes.map((l) => custos.get(l.id)).filter((c) => c && c.pedaisBons > 0);
  const media = comCusto.length ? comCusto.reduce((a, c) => a + c!.total, 0) / comCusto.reduce((a, c) => a + c!.pedaisBons, 0) : null;
  const recentes = [...base.apontamentos].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 12);

  // Custo planejado de um lote: composição × pedais, pelo custo médio de hoje.
  const planejadoPorPedal = (loteId: string) => {
    const itens = base.loteItens.filter((i) => i.loteId === loteId);
    let total = 0;
    let pedais = 0;
    for (const i of itens) {
      const qtd = i.qtdProduzida ?? i.qtdPlanejada;
      pedais += qtd;
      for (const ci of base.composicaoItens.filter((c) => c.composicaoId === composicaoDoItem(i, produtos))) {
        const c = componentes.get(ci.componenteId);
        const unit = medio.get(ci.componenteId) || c?.custoReferencia || 0;
        total += c && c.modoCobranca !== "unidade" ? ci.quantidade * unit : ci.quantidade * unit * qtd;
      }
    }
    return pedais ? total / pedais : null;
  };

  const salvar = async () => {
    await salvarConfigProducao({ valorHora: valorHora ?? 0, margemPadrao: margem ?? 0 });
    avisar("Parâmetros salvos. Valem para os próximos registros de produção.");
  };
  const mudou = (valorHora ?? 0) !== config.valorHora || (margem ?? 0) !== config.margemPadrao;

  return (
    <>
      <Cabecalho
        sobretitulo="Operação"
        titulo="Produção e custos"
        descricao="Quantos pedais foram montados e quanto cada um custou de verdade: peças usadas, mão de obra e outros custos do lote."
      />
      <div className="pilha">
        <Faixa
          itens={[
            { rotulo: `Pedais bons em ${ano}`, valor: num(bons), detalhe: plural(apsAno.length, "registro de produção", "registros de produção") },
            { rotulo: "Refugo", valor: bons + refugo ? pct(refugo / (bons + refugo)) : "—", detalhe: plural(refugo, "pedal refugado", "pedais refugados") },
            { rotulo: "Horas de montagem", valor: num(horas), detalhe: bons ? `${num(horas / bons)} h por pedal` : "—" },
            { rotulo: "Custo real médio", valor: media != null ? brl(media) : "—", detalhe: "Por pedal bom" },
          ]}
        />

        <div className="grade grade-lado">
          <Cartao icone={Calculator} className="cartao-lista" titulo="Custo real por lote" sub="Compare com o planejado: a diferença mostra perdas, refugo e preços que mudaram.">
            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th className="num">Bons</th>
                    <th className="num">Peças</th>
                    <th className="num">Mão de obra</th>
                    <th className="num">Outros</th>
                    <th className="num">Por pedal</th>
                    <th className="num">Planejado</th>
                  </tr>
                </thead>
                <tbody>
                  {lotes.map((l) => {
                    const c = custos.get(l.id)!;
                    const plan = planejadoPorPedal(l.id);
                    const desvio = c.porPedal != null && plan ? c.porPedal / plan - 1 : null;
                    return (
                      <tr key={l.id} className="clicavel" onClick={() => ir(`/lotes/${l.id}/custos`)}>
                        <td>
                          <div className="celula-com-foto">
                            <Tag codigo>{l.codigo}</Tag>
                            <Status cor={COR_LOTE[l.status]}>{ROTULOS.statusLote[l.status]}</Status>
                          </div>
                        </td>
                        <td className="num">{num(c.pedaisBons)}</td>
                        <td className="num">{brl(c.materiais + c.diretos)}</td>
                        <td className="num">{brl(c.maoDeObra)}</td>
                        <td className="num">{brl(c.outros)}</td>
                        <td className="num celula-titulo">{c.porPedal != null ? brl(c.porPedal) : "—"}</td>
                        <td className="num">
                          {plan ? brl(plan) : "—"}
                          {desvio != null && Math.abs(desvio) >= 0.005 && <div className={`sub ${desvio > 0 ? "negativo" : "positivo"}`}>{desvio > 0 ? "+" : ""}{pct(desvio)}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {lotes.length === 0 && <p className="lista-vazia">Nenhum lote com produção registrada. Registre a produção dentro do lote, na aba Produção.</p>}
            </div>
          </Cartao>

          <Cartao icone={Settings2} titulo="Parâmetros de custo">
            <div className="formulario uma-coluna">
              <Campo rotulo="Valor da hora de mão de obra" htmlFor="pr-hora" dica="Quanto vale uma hora sua (ou de quem monta). As horas de cada registro de produção viram custo por este valor.">
                <Moeda id="pr-hora" valor={valorHora} aoMudar={setValorHora} />
              </Campo>
              <Campo rotulo="Margem de sobra padrão" htmlFor="pr-margem" dica="Sugerida em lotes novos.">
                <Numero id="pr-margem" valor={margem} aoMudar={setMargem} sufixo="%" />
              </Campo>
            </div>
            <div className="rodape-form">
              <button className="botao primario" onClick={salvar} disabled={!mudou}>
                Salvar parâmetros
              </button>
            </div>
          </Cartao>
        </div>

        <Cartao icone={Wrench} className="cartao-lista" titulo="Últimos registros de produção">
          <div className="tabela-wrap">
            <table className="tabela">
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
                {recentes.map((a) => {
                  const l = base.lotes.find((x) => x.id === a.loteId);
                  return (
                    <tr key={a.id} className="clicavel" onClick={() => ir(`/lotes/${a.loteId}/producao`)}>
                      <td className="sem-quebra">{data(a.data)}</td>
                      <td>{l ? <Tag codigo>{l.codigo}</Tag> : "—"}</td>
                      <td className="celula-titulo">{produtos.get(a.produtoId)?.nome ?? a.produtoId}</td>
                      <td className="num">{num(a.qtdBoa)}</td>
                      <td className="num">{a.qtdRefugo ? num(a.qtdRefugo) : <span className="fraco">—</span>}</td>
                      <td className="num">{a.horas ? num(a.horas) : <span className="fraco">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {recentes.length === 0 && <p className="lista-vazia">Ao montar pedais, abra o lote e use “Registrar produção”: as peças saem do estoque e o custo real aparece aqui.</p>}
          </div>
        </Cartao>
      </div>
    </>
  );
}
