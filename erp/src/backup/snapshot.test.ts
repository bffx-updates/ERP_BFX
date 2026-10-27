import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db";
import { aplicarImportacao } from "../importacao/aplicar";
import { converterLegado, type BackupLegado } from "../importacao/legado";
import { apagarTudo, ehSnapshot, gerarSnapshot, restaurarSnapshot } from "./snapshot";

const legado: BackupLegado = {
  db: {
    parts: { sw: { name: "Chave SPST", cat: "Eletromecânica", price: 2, url: "https://pt.aliexpress.com/item/1.html" } },
    models: { m8: { name: "8SW+", salePrice: 100, bom: { sw: 8 } } },
  },
  inventory: { sw: 10 },
};

beforeEach(async () => {
  await apagarTudo();
  await db.sistema.clear();
});

describe("importação no banco", () => {
  it("grava os registros e preserva os dados da empresa", async () => {
    await db.config.put({ chave: "empresa", valor: { nome: "BFFX" } });
    await aplicarImportacao(converterLegado(legado).registros);
    expect(await db.componentes.count()).toBe(1);
    expect(await db.composicaoItens.count()).toBe(1);
    expect(await db.movimentos.count()).toBe(1);
    expect((await db.config.get("empresa"))?.valor).toEqual({ nome: "BFFX" });
  });

  it("reimportar substitui em vez de duplicar", async () => {
    await aplicarImportacao(converterLegado(legado).registros);
    await aplicarImportacao(converterLegado(legado).registros);
    expect(await db.componentes.count()).toBe(1);
    expect(await db.movimentos.count()).toBe(1);
  });
});

describe("snapshot", () => {
  it("ida e volta: gerar, apagar e restaurar devolve os mesmos dados", async () => {
    await aplicarImportacao(converterLegado(legado).registros);
    await db.anexos.put({
      id: "a1",
      refTipo: "compra",
      refId: "c1",
      nome: "nota.xml",
      mime: "text/xml",
      tamanho: 5,
      conteudo: new Blob(["<nfe/>"], { type: "text/xml" }),
      criadoEm: "2026-09-27T00:00:00.000Z",
    });
    await db.sistema.put({ chave: "ultimoBackup", valor: "x" });

    const snap = JSON.parse(JSON.stringify(await gerarSnapshot()));
    expect(ehSnapshot(snap)).toBe(true);
    expect(snap.tabelas.sistema).toBeUndefined(); // estado interno nunca vai para o backup
    expect(snap.tabelas.anexos[0].conteudo.__blob).toMatch(/^data:text\/xml;base64,/);

    const antes = await db.componentes.toArray();
    await apagarTudo();
    expect(await db.componentes.count()).toBe(0);

    await restaurarSnapshot(snap);
    expect(await db.componentes.toArray()).toEqual(antes);
    const anexo = await db.anexos.get("a1");
    expect(await (anexo!.conteudo as Blob).text()).toBe("<nfe/>");
  });

  it("rejeita arquivos que não são backup do ERP", () => {
    expect(ehSnapshot({ app: "outro", formato: 1, tabelas: {} })).toBe(false);
    expect(ehSnapshot(legado)).toBe(false);
  });
});
