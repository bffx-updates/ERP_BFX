import { Building2, Download, FolderOpen, FolderSync, HardDriveDownload, Import, Link2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  agendarSincronizacao,
  escolherPastaSincronizada,
  reativarPasta,
  renomearDispositivo,
  sincronizarAgora,
  suportaPasta,
  useStatusSincronizacao,
} from "../backup/sincronizacao";
import { apagarTudo, baixarArquivo, ehSnapshot, gerarSnapshot, restaurarSnapshot, resumoSnapshot } from "../backup/snapshot";
import { EMPRESA_PADRAO, useEmpresa, useResumo } from "../data/consultas";
import { salvarConfig } from "../data/db";
import { cnpjValido, dataEHora, formatarDocumento, haQuanto, num, ROTULOS, soDocumento } from "../data/formato";
import type { Empresa } from "../data/tipos";
import { DEMO } from "../demo";
import { aplicarImportacao, temDados } from "../importacao/aplicar";
import { converterLegado, ehBackupLegado, lerLegadoDoNavegador, type ResultadoImportacao } from "../importacao/legado";
import { Aviso, Cabecalho, Cartao, Faixa, Status, Tag, useFeedback, type CorLed } from "../ui/base";

export function Dados() {
  return (
    <>
      <Cabecalho
        sobretitulo="Configuração"
        titulo="Dados e backup"
        descricao="Os dados ficam neste navegador e são sincronizados com os outros computadores por uma pasta do OneDrive, que também guarda uma cópia por dia."
      />
      <div className="grade grade-2">
        <div className="pilha">
          {DEMO ? <CartaoDemonstracao /> : <CartaoSincronizacao />}
          <CartaoImportacao />
        </div>
        <div className="pilha">
          <CartaoEmpresa />
          <CartaoManual />
          <CartaoPerigo />
        </div>
      </div>
    </>
  );
}

function CartaoDemonstracao() {
  return (
    <Cartao icone={FolderSync} titulo="Sincronização desligada na demonstração" sub="Esta é uma cópia de demonstração, com dados fictícios.">
      <Aviso titulo="Separada do ERP de verdade">
        Ela guarda os dados num banco próprio deste navegador e não grava em pasta nenhuma. Pode criar, editar e apagar à vontade; para voltar ao começo, use “Recomeçar” na faixa do topo.
      </Aviso>
    </Cartao>
  );
}

function CartaoSincronizacao() {
  const s = useStatusSincronizacao();
  const { avisar } = useFeedback();
  const [nome, setNome] = useState("");

  useEffect(() => {
    if (s.dispositivo) setNome(s.dispositivo.nome);
  }, [s.dispositivo]);

  if (!suportaPasta) {
    return (
      <Cartao icone={FolderSync} titulo="Sincronização entre computadores" sub="Este navegador não consegue gravar numa pasta.">
        <Aviso titulo="Abra o app no Chrome ou no Edge">Enquanto isso, use “Baixar backup” de tempos em tempos.</Aviso>
      </Cartao>
    );
  }

  let estado: { cor: CorLed; texto: string } = { cor: "verde", texto: "Sincronizada" };
  if (s.pasta === "nao_configurada") estado = { cor: "ambar", texto: "Desligada" };
  else if (s.pasta === "precisa_permissao") estado = { cor: "ambar", texto: "Pasta desconectada" };
  else if (s.conflito || s.copia || s.erro) estado = { cor: "vermelho", texto: "Precisa da sua decisão (veja o aviso no topo)" };
  else if (s.ocupado || s.pendente) estado = { cor: "laranja", texto: "Sincronizando…" };

  const nomeMudou = !!nome.trim() && nome.trim() !== s.dispositivo?.nome;

  return (
    <Cartao
      icone={FolderSync}
      titulo="Sincronização entre computadores"
      sub="Use a mesma pasta do OneDrive em todos os computadores. A cada alteração o app grava nela, e ao abrir busca o que mudou nos outros."
    >
      <div className="pilha" style={{ gap: 16 }}>
        <div className="acoes" style={{ gap: 12 }}>
          <Status cor={estado.cor}>{estado.texto}</Status>
          {s.nomePasta && (
            <Tag codigo>
              <FolderOpen size={13} aria-hidden="true" />
              {s.nomePasta}
            </Tag>
          )}
        </div>

        <div className="sub" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
          <div>Última sincronização: {s.ultimo ? `${dataEHora(s.ultimo)} (${haQuanto(s.ultimo)})` : "nenhuma ainda"}</div>
          {s.ultimaExterna && (
            <div>
              Última alteração vinda de outro computador: {s.ultimaExterna.dispositivo}, {dataEHora(s.ultimaExterna.em)}
            </div>
          )}
        </div>

        <div className="campo">
          <label htmlFor="nome-computador">Nome deste computador</label>
          <div className="campo-linha">
            <input
              id="nome-computador"
              className="entrada"
              value={nome}
              placeholder="Ex.: Notebook, Oficina"
              onChange={(e) => setNome(e.target.value)}
            />
            <button
              className="botao"
              disabled={!nomeMudou}
              onClick={async () => {
                await renomearDispositivo(nome);
                avisar("Nome do computador salvo.");
              }}
            >
              Salvar nome
            </button>
          </div>
          <span className="sub">Aparece nos outros computadores quando houver alterações ou conflito.</span>
        </div>

        <div className="acoes">
          {s.pasta === "precisa_permissao" ? (
            <button
              className="botao primario"
              onClick={async () => {
                if (!(await reativarPasta())) avisar("Permissão negada. A pasta continua desconectada.", true);
              }}
            >
              <Link2 aria-hidden="true" />
              Conectar pasta
            </button>
          ) : (
            <button className={`botao ${s.pasta === "nao_configurada" ? "primario" : ""}`} onClick={() => void escolherPastaSincronizada()}>
              <FolderOpen aria-hidden="true" />
              {s.pasta === "nao_configurada" ? "Escolher pasta" : "Trocar pasta"}
            </button>
          )}
          {s.pasta === "ativa" && (
            <button
              className="botao"
              disabled={s.ocupado}
              onClick={() => void sincronizarAgora()}
            >
              <RefreshCw aria-hidden="true" />
              Sincronizar agora
            </button>
          )}
        </div>

        <div>
          <div className="legenda" style={{ marginBottom: 12 }}>
            Para usar em outro computador
          </div>
          <ol className="instrucoes">
            <li>
              Copie o arquivo <span className="mono">BFX Technologies ERP.html</span> para o outro computador.
            </li>
            <li>Abra no Chrome ou no Edge e entre em Dados e backup.</li>
            <li>Clique em Escolher pasta e escolha esta mesma pasta do OneDrive. Os dados são carregados sozinhos.</li>
            <li>Use um computador de cada vez. Ao trocar, espere o OneDrive terminar de sincronizar.</li>
          </ol>
        </div>
      </div>
    </Cartao>
  );
}

function CartaoEmpresa() {
  const salva = useEmpresa();
  const { avisar } = useFeedback();
  const [form, setForm] = useState<Empresa>(EMPRESA_PADRAO);
  const [editando, setEditando] = useState(false);
  const [tentou, setTentou] = useState(false);

  // Acompanha os dados salvos (inclusive os que chegam de outro computador) enquanto não houver edição aqui.
  useEffect(() => {
    if (salva && !editando) setForm(salva);
  }, [salva, editando]);

  const campo = <K extends keyof Empresa>(k: K) => ({
    value: (form[k] ?? "") as string,
    onChange: (e: { target: { value: string } }) => {
      setEditando(true);
      setForm({ ...form, [k]: e.target.value });
    },
  });

  const cnpjOk = !soDocumento(form.cnpj) || cnpjValido(form.cnpj);
  const salvar = async () => {
    setTentou(true);
    if (!cnpjOk) return;
    const limpo = (t?: string) => t?.trim() || undefined;
    await salvarConfig("empresa", {
      ...form,
      nome: form.nome.trim(),
      cnpj: soDocumento(form.cnpj) ? formatarDocumento(form.cnpj) : "",
      razaoSocial: limpo(form.razaoSocial),
      inscricaoEstadual: limpo(form.inscricaoEstadual),
      municipio: limpo(form.municipio),
      contador: limpo(form.contador),
      contadorEmail: limpo(form.contadorEmail),
    });
    setEditando(false);
    setTentou(false);
    avisar("Dados da empresa salvos.");
  };

  // Até os dados salvos chegarem, o formulário fica travado para não sobrescrever o que for digitado.
  const pronto = !!salva;

  return (
    <Cartao icone={Building2} titulo="Empresa" sub="Sai no cabeçalho dos relatórios para a contabilidade.">
      <fieldset disabled={!pronto}>
        <div className="formulario">
          <div className="campo">
            <label htmlFor="emp-nome">Nome fantasia</label>
            <input id="emp-nome" className="entrada" {...campo("nome")} />
          </div>
          <div className="campo">
            <label htmlFor="emp-razao">
              Razão social<span className="opcional">opcional</span>
            </label>
            <input id="emp-razao" className="entrada" {...campo("razaoSocial")} placeholder="Como está no CNPJ" />
          </div>
          <div className={`campo ${tentou && !cnpjOk ? "com-erro" : ""}`}>
            <label htmlFor="emp-cnpj">CNPJ</label>
            <input id="emp-cnpj" className="entrada mono" placeholder="00.000.000/0000-00" {...campo("cnpj")} />
            {tentou && !cnpjOk && <div className="campo-erro">CNPJ inválido. Confira os números.</div>}
          </div>
          <div className="campo">
            <label htmlFor="emp-ie">
              Inscrição estadual<span className="opcional">opcional</span>
            </label>
            <input id="emp-ie" className="entrada mono" {...campo("inscricaoEstadual")} />
          </div>
          <div className="campo">
            <label htmlFor="emp-regime">Regime tributário</label>
            <select id="emp-regime" className="entrada" {...campo("regime")}>
              {Object.entries(ROTULOS.regime).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="emp-transicao">Saída do MEI</label>
            <input id="emp-transicao" type="date" className="entrada" {...campo("dataTransicao")} />
          </div>
          <div className="campo">
            <label htmlFor="emp-municipio">
              Cidade/UF<span className="opcional">opcional</span>
            </label>
            <input id="emp-municipio" className="entrada" {...campo("municipio")} placeholder="Ex.: Curitiba/PR" />
          </div>
          <div className="campo">
            <label htmlFor="emp-contador">
              Contador<span className="opcional">opcional</span>
            </label>
            <input id="emp-contador" className="entrada" {...campo("contador")} placeholder="Nome ou escritório" />
          </div>
          <div className="campo campo-inteiro">
            <label htmlFor="emp-contador-email">
              E-mail do contador<span className="opcional">opcional</span>
            </label>
            <input id="emp-contador-email" type="email" className="entrada" {...campo("contadorEmail")} />
          </div>
        </div>
        <div className="rodape-form">
          <button className="botao primario" onClick={salvar} disabled={!editando}>
            Salvar dados da empresa
          </button>
        </div>
      </fieldset>
    </Cartao>
  );
}

function CartaoImportacao() {
  const resumo = useResumo();
  const { avisar, confirmar } = useFeedback();
  const [previa, setPrevia] = useState<(ResultadoImportacao & { origem: string }) | null>(null);
  const [importando, setImportando] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const doNavegador = () => {
    const legado = lerLegadoDoNavegador();
    if (!legado) {
      avisar("Não há dados do app antigo neste navegador. Use “Escolher arquivo” com o bfmidi-backup.json.", true);
      return;
    }
    setPrevia({ ...converterLegado(legado), origem: "dados do app antigo neste navegador" });
  };

  const doArquivo = async (f: File | undefined) => {
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (!ehBackupLegado(json)) throw new Error();
      setPrevia({ ...converterLegado(json), origem: f.name });
    } catch {
      avisar("Esse arquivo não é um backup do app antigo (bfmidi-backup.json).", true);
    }
  };

  const importar = async () => {
    if (!previa) return;
    if (
      (await temDados()) &&
      !(await confirmar({
        titulo: "Substituir os dados atuais?",
        texto: "O ERP já tem dados. A importação apaga os cadastros, compras, estoque, lotes e registros de produção atuais e coloca os do app antigo no lugar. Com a sincronização ligada, isso também vale para os outros computadores.\n\nOs dados da empresa são mantidos.",
        confirmar: "Substituir dados",
        perigo: true,
      }))
    )
      return;
    setImportando(true);
    try {
      await aplicarImportacao(previa.registros);
      agendarSincronizacao();
      setPrevia(null);
      avisar("Dados importados.");
    } catch (e) {
      avisar(`A importação falhou: ${(e as Error).message}`, true);
    } finally {
      setImportando(false);
    }
  };

  const r = previa?.registros;
  return (
    <Cartao
      icone={Import}
      titulo="Importar do app antigo"
      sub="Traz peças, modelos, estoque, compras e histórico de lotes. O app antigo não é alterado."
    >
      {!previa && (
        <div className="acoes">
          {/* Só chama atenção enquanto o ERP está vazio; depois vira uma ação comum. */}
          <button className={`botao ${resumo?.vazio ? "primario" : ""}`} onClick={doNavegador}>
            <Import aria-hidden="true" />
            Buscar neste navegador
          </button>
          <button className="botao" onClick={() => arquivo.current?.click()}>
            <Upload aria-hidden="true" />
            Escolher arquivo…
          </button>
          <input
            ref={arquivo}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void doArquivo(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {previa && r && (
        <div className="pilha" style={{ gap: 14 }}>
          <p className="fraco" style={{ margin: 0, fontSize: 13 }}>
            Encontrado em: {previa.origem}
          </p>
          <Faixa
            colunas={3}
            itens={[
              { rotulo: "Componentes", valor: num(r.componentes.length) },
              { rotulo: "Produtos", valor: num(r.produtos.length) },
              { rotulo: "Fornecedores", valor: num(r.fornecedores.length) },
              { rotulo: "Lotes", valor: num(r.lotes.length) },
              { rotulo: "Compras", valor: num(r.compras.length) },
              { rotulo: "Peças em estoque", valor: num(r.movimentos.length) },
            ]}
          />
          {previa.avisos.length > 0 && (
            <Aviso titulo="Para conferir depois">
              <ul>
                {previa.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Aviso>
          )}
          <div className="acoes">
            <button className="botao primario" disabled={importando} onClick={importar}>
              {importando ? "Importando…" : "Importar dados"}
            </button>
            <button className="botao fantasma" disabled={importando} onClick={() => setPrevia(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </Cartao>
  );
}

function CartaoManual() {
  const { avisar, confirmar } = useFeedback();
  const arquivo = useRef<HTMLInputElement>(null);

  const baixar = async () => {
    const snap = await gerarSnapshot();
    const hoje = new Date().toLocaleDateString("sv-SE");
    baixarArquivo(`bffx-dados-${hoje}.json`, JSON.stringify(snap, null, 1));
  };

  const restaurar = async (f: File | undefined) => {
    if (!f) return;
    let json: unknown;
    try {
      json = JSON.parse(await f.text());
    } catch {
      return avisar("Não foi possível ler esse arquivo.", true);
    }
    if (ehBackupLegado(json)) return avisar("Esse é um backup do app antigo. Use “Importar do app antigo”.", true);
    if (!ehSnapshot(json)) return avisar("Esse arquivo não é um backup do BFX Technologies ERP.", true);
    const ok = await confirmar({
      titulo: "Restaurar este backup?",
      texto: `Backup de ${dataEHora(json.exportadoEm)}: ${resumoSnapshot(json)}.\n\nTodos os dados atuais serão substituídos, também nos outros computadores sincronizados.`,
      confirmar: "Restaurar backup",
      perigo: true,
    });
    if (!ok) return;
    try {
      await restaurarSnapshot(json);
      agendarSincronizacao();
      avisar("Backup restaurado.");
    } catch (e) {
      avisar(`A restauração falhou: ${(e as Error).message}`, true);
    }
  };

  return (
    <Cartao icone={HardDriveDownload} titulo="Backup manual" sub="Um arquivo com todos os dados, para guardar onde quiser ou levar para outro computador.">
      <div className="acoes">
        <button className="botao" onClick={baixar}>
          <Download aria-hidden="true" />
          Baixar backup
        </button>
        <button className="botao" onClick={() => arquivo.current?.click()}>
          <Upload aria-hidden="true" />
          Restaurar backup…
        </button>
        <input
          ref={arquivo}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void restaurar(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </Cartao>
  );
}

function CartaoPerigo() {
  const { avisar, confirmar } = useFeedback();
  const apagar = async () => {
    const ok = await confirmar({
      titulo: "Apagar todos os dados?",
      texto: "Apaga componentes, produtos, fornecedores, estoque, compras, lotes e configurações deste navegador.\n\nCom a sincronização ligada, os dados também somem da pasta e dos outros computadores. As cópias diárias em historico/ continuam lá.",
      confirmar: "Apagar tudo",
      perigo: true,
    });
    if (!ok) return;
    await apagarTudo();
    agendarSincronizacao();
    avisar("Dados apagados.");
  };
  return (
    <Cartao icone={Trash2} titulo="Apagar dados" sub="Remove tudo deste navegador. Não tem como desfazer, a não ser restaurando um backup." className="cartao-perigo">
      <button className="botao perigo" onClick={apagar}>
        <Trash2 aria-hidden="true" />
        Apagar todos os dados
      </button>
    </Cartao>
  );
}
