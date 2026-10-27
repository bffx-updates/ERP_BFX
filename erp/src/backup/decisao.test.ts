import { describe, expect, it } from "vitest";
import { decidirSincronizacao, type SituacaoLocal } from "./decisao";

const base: SituacaoLocal = { pendente: false, temDados: true, pastaNova: false };
const arquivo = (revisao: string, legado = false) => ({ revisao, legado });

describe("decidirSincronizacao", () => {
  it("pasta vazia: grava se houver dados ou alterações, senão não faz nada", () => {
    expect(decidirSincronizacao({ ...base })).toBe("escrever");
    expect(decidirSincronizacao({ ...base, temDados: false })).toBe("nada");
    expect(decidirSincronizacao({ ...base, temDados: false, pendente: true })).toBe("escrever");
  });

  it("arquivo igual ao que este computador conhece: grava só se houver alteração local", () => {
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("r1"), revisaoLocal: "r1" })).toBe("nada");
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("r1"), revisaoLocal: "r1", pendente: true })).toBe("escrever");
  });

  it("apagar tudo aqui também vai para a pasta quando ninguém mais mudou", () => {
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("r1"), revisaoLocal: "r1", temDados: false, pendente: true })).toBe("escrever");
  });

  it("computador novo e vazio carrega o que está na pasta", () => {
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("r1"), temDados: false, pastaNova: true })).toBe("carregar");
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("r1", true), temDados: false })).toBe("carregar");
  });

  it("outro computador mudou e aqui não há alteração: carrega", () => {
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("r2"), revisaoLocal: "r1" })).toBe("carregar");
  });

  it("os dois computadores mudaram: pergunta", () => {
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("r2"), revisaoLocal: "r1", pendente: true })).toBe("conflito");
  });

  it("pasta escolhida agora já tem dados e este computador também: pergunta, nunca sobrescreve", () => {
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("r1"), pastaNova: true })).toBe("conflito");
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("r1"), pastaNova: true, pendente: true })).toBe("conflito");
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("legado:x", true), pastaNova: true })).toBe("conflito");
  });

  it("escolher de novo a mesma pasta não causa conflito", () => {
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("r1"), revisaoLocal: "r1", pastaNova: true })).toBe("nada");
  });

  it("arquivo antigo, sem revisão, gravado por este computador: atualiza para o formato novo", () => {
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("legado:x", true) })).toBe("escrever");
    expect(decidirSincronizacao({ ...base, arquivo: arquivo("legado:x", true), pendente: true })).toBe("escrever");
  });
});
