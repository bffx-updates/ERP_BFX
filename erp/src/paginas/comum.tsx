import { Import, Plus } from "lucide-react";
import type { StatusCompra, StatusLote } from "../data/tipos";
import { Vazio, type CorLed, type Icone } from "../ui/base";

export function SemDados(props: { titulo: string; icone: Icone; texto?: string; novo?: { rotulo: string; href: string } }) {
  return (
    <Vazio
      icone={props.icone}
      titulo={props.titulo}
      texto={props.texto ?? "Cadastre o primeiro agora ou importe os dados do app antigo, que trazem peças, modelos, estoque e lotes juntos."}
      acao={
        <div className="acoes" style={{ justifyContent: "center" }}>
          {props.novo && (
            <a className="botao primario" href={props.novo.href}>
              <Plus aria-hidden="true" />
              {props.novo.rotulo}
            </a>
          )}
          <a className={`botao ${props.novo ? "" : "primario"}`} href="#/dados">
            <Import aria-hidden="true" />
            Importar do app antigo
          </a>
        </div>
      }
    />
  );
}

export const COR_LOTE: Record<StatusLote, CorLed> = {
  planejado: "apagado",
  comprando: "laranja",
  em_producao: "ambar",
  concluido: "verde",
  cancelado: "vermelho",
};

export const COR_COMPRA: Record<StatusCompra, CorLed> = {
  rascunho: "apagado",
  pedido: "laranja",
  em_transito: "laranja",
  recebida_parcial: "ambar",
  recebida: "verde",
  cancelada: "vermelho",
};
