import { describe, expect, it } from "vitest";
import { lerNFe, lerXml } from "./nfe";

export const XML_EXEMPLO = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35260912345678000195550010000012341000123454" versao="4.00">
      <ide><cUF>35</cUF><nNF>1234</nNF><serie>1</serie><dhEmi>2026-09-15T10:30:00-03:00</dhEmi></ide>
      <emit>
        <CNPJ>12345678000195</CNPJ><xNome>Eletr&#244;nicos Exemplo LTDA</xNome><xFant>Exemplo</xFant>
        <enderEmit><xMun>S&#227;o Paulo</xMun><UF>SP</UF></enderEmit>
      </emit>
      <dest><CNPJ>98765432000198</CNPJ><xNome>BFX TECHNOLOGIES</xNome></dest>
      <det nItem="1">
        <prod><cProd>ESP-N16</cProd><xProd>Modulo ESP32-S3 N16R8 &amp; antena</xProd><NCM>85423190</NCM><CFOP>6102</CFOP><uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>38.4000</vUnCom><vProd>384.00</vProd><vDesc>4.00</vDesc></prod>
      </det>
      <det nItem="2">
        <prod><cProd>DIN5</cProd><xProd>Conector DIN 5 pinos</xProd><NCM>85366990</NCM><CFOP>6102</CFOP><uCom>PC</uCom><qCom>20</qCom><vUnCom>5.90</vUnCom><vProd>118.00</vProd></prod>
      </det>
      <total><ICMSTot><vProd>502.00</vProd><vDesc>4.00</vDesc><vFrete>25.50</vFrete><vSeg>0.00</vSeg><vOutro>1.00</vOutro><vIPI>12.00</vIPI><vST>0.00</vST><vII>0.00</vII><vNF>536.50</vNF></ICMSTot></total>
    </infNFe>
    <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature>
  </NFe>
  <protNFe versao="4.00"><infProt><chNFe>35260912345678000195550010000012341000123454</chNFe></infProt></protNFe>
</nfeProc>`;

describe("leitor de XML", () => {
  it("lê elementos, atributos, entidades e CDATA", () => {
    const doc = lerXml(`<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><ns:b>t&lt;u</ns:b><c/><d><![CDATA[<cru>]]></d></a>`);
    const a = doc.filhos[0];
    expect(a.atributos.x).toBe("1 & 2");
    expect(a.filhos.map((f) => f.nome)).toEqual(["b", "c", "d"]);
    expect(a.filhos[0].texto).toBe("t<u");
    expect(a.filhos[2].texto).toBe("<cru>");
  });
});

describe("NF-e", () => {
  it("extrai emitente, itens e totais", () => {
    const n = lerNFe(XML_EXEMPLO);
    expect(n.chave).toBe("35260912345678000195550010000012341000123454");
    expect(n.numero).toBe("1234");
    expect(n.emitente).toMatchObject({ documento: "12345678000195", nome: "Eletrônicos Exemplo LTDA", uf: "SP", municipio: "São Paulo" });
    expect(n.itens).toHaveLength(2);
    expect(n.itens[0]).toMatchObject({ codigo: "ESP-N16", descricao: "Modulo ESP32-S3 N16R8 & antena", ncm: "85423190", quantidade: 10, valorLiquido: 380 });
    expect(n.totais).toMatchObject({ frete: 25.5, ipi: 12, outras: 1, nota: 536.5 });
    expect(n.emissao).toBe("2026-09-15T13:30:00.000Z");
  });

  it("recusa o que não é NF-e", () => {
    expect(() => lerNFe("<html><body/></html>")).toThrow(/não é o XML de uma NF-e/);
  });
});
