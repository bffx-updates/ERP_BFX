// Faixa no topo de todas as telas quando a sincronização precisa de uma decisão do usuário.
import { useEffect } from "react";
import {
  ouvirAvisos,
  reativarPasta,
  resolverConflito,
  resolverCopiaExtra,
  substituirArquivoIlegivel,
  useStatusSincronizacao,
} from "../backup/sincronizacao";
import { dataEHora } from "../data/formato";
import { Aviso, useFeedback } from "./base";

export function AvisosSincronizacao() {
  const s = useStatusSincronizacao();
  const { avisar } = useFeedback();

  // Mensagens do motor de sincronização viram avisos rápidos na tela.
  useEffect(() => ouvirAvisos((a) => avisar(a.texto, a.erro)), [avisar]);

  const conteudo = (() => {
    if (s.pasta === "precisa_permissao") {
      return (
        <Aviso
          titulo="Conecte a pasta sincronizada"
          acao={
            <button
              className="botao primario pequeno"
              onClick={async () => {
                if (!(await reativarPasta())) avisar("Permissão negada. A pasta continua desconectada.", true);
              }}
            >
              Conectar pasta
            </button>
          }
        >
          Assim o app busca o que foi alterado nos outros computadores antes de você editar.
        </Aviso>
      );
    }

    if (s.conflito) {
      const { versao, tipo } = s.conflito;
      const quando = dataEHora(versao.exportadoEm);
      return (
        <Aviso
          erro
          titulo={tipo === "primeira_conexao" ? "Esta pasta já tem dados do ERP" : "Os dados mudaram em dois computadores"}
          acao={
            <div className="acoes">
              <button className="botao primario pequeno" disabled={s.ocupado} onClick={() => void resolverConflito("pasta")}>
                {tipo === "primeira_conexao" ? "Usar os dados da pasta" : `Usar a versão de ${versao.dispositivo}`}
              </button>
              <button className="botao pequeno" disabled={s.ocupado} onClick={() => void resolverConflito("local")}>
                {tipo === "primeira_conexao" ? "Substituir pelos deste computador" : "Manter a deste computador"}
              </button>
            </div>
          }
        >
          {tipo === "primeira_conexao"
            ? `A pasta tem dados salvos por ${versao.dispositivo} em ${quando} (${versao.resumo}), e este computador também tem dados. Escolha quais ficam.`
            : `${versao.dispositivo} gravou alterações em ${quando}, e este computador também tem alterações que ainda não estavam na pasta. Escolha qual versão continua.`}{" "}
          A outra fica guardada em conflitos/, na pasta.
        </Aviso>
      );
    }

    if (s.copia) {
      const { nome, versao } = s.copia;
      return (
        <Aviso
          erro
          titulo="O OneDrive guardou duas versões dos dados"
          acao={
            <div className="acoes">
              <button className="botao pequeno" disabled={s.ocupado || !versao} onClick={() => void resolverCopiaExtra("usar")}>
                Usar essa versão
              </button>
              <button className="botao primario pequeno" disabled={s.ocupado} onClick={() => void resolverCopiaExtra("descartar")}>
                Descartar essa versão
              </button>
            </div>
          }
        >
          Além do arquivo principal, a pasta tem {nome}
          {versao ? `, salvo por ${versao.dispositivo} em ${dataEHora(versao.exportadoEm)} (${versao.resumo})` : ", que não pôde ser lido"}. Isso
          acontece quando dois computadores gravam antes de o OneDrive terminar de sincronizar. A versão descartada fica guardada em
          conflitos/.
        </Aviso>
      );
    }

    if (s.erro) {
      return (
        <Aviso
          erro
          titulo={s.arquivoIlegivel ? "Não foi possível ler os dados da pasta" : "A sincronização falhou"}
          acao={
            s.arquivoIlegivel && (
              <button className="botao pequeno" disabled={s.ocupado} onClick={() => void substituirArquivoIlegivel()}>
                Gravar a versão deste computador
              </button>
            )
          }
        >
          {s.erro}
          {s.arquivoIlegivel && " Se o problema continuar, grave a versão deste computador; o arquivo ilegível fica guardado em conflitos/."}
        </Aviso>
      );
    }
    return null;
  })();

  return conteudo && <div className="avisos-sinc">{conteudo}</div>;
}
