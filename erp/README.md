# BFX Technologies ERP

Sistema de gestão da BFX Technologies (pedais BFMiDi): fornecedores, componentes, estoque, composição dos produtos, lotes, compras, custos de fabricação, histórico de produção e relatórios para a contabilidade.

## O dia a dia

- **Compras** — lance à mão ou importe o **XML da NF-e** (fornecedor, itens, frete e impostos vêm preenchidos; o app lembra qual item da nota é qual peça). Ao marcar como **Recebida**, as peças entram no estoque com frete, impostos e outras despesas rateados no custo. Anexe o PDF/XML da nota.
- **Estoque** — saldo, movimentações, **ficha por componente** (kardex), **ajustes** (entrada/saída avulsa, perda, devolução) e **contagem física**. A contagem na data de saída do MEI vira o saldo inicial oficial.
- **Lotes** — diga quantos pedais de cada modelo; o app calcula as peças que faltam (com margem de sobra, estoque e pedidos a receber) e **gera os pedidos por fornecedor**. Em **Produção**, cada registro baixa as peças do estoque e lança as horas como mão de obra. A aba **Custo real** mostra quanto cada pedal custou.
- **Cadastros** — fornecedores (CNPJ/CPF validado), componentes (NCM, origem, cobrança, fornecedores e preços) e produtos (foto, preço, dados fiscais, composição versionada: mudar as peças cria uma versão nova e os lotes antigos mantêm a deles).
- **Contabilidade** — escolha o mês, o ano ou um período e abra o **fechamento**: resumo, compras, movimentação de estoque, inventário, produção, pendências e os critérios de custo. Use *Imprimir → Salvar como PDF* para mandar ao contador.

## Como usar

Abra **`BFX Technologies ERP.html`** (na pasta principal) no **Chrome** ou no **Edge**. Não precisa de internet nem de servidor. Abre no tema claro; o escuro fica no botão da lua, no alto do menu.

- Os dados ficam no navegador (IndexedDB). Use sempre o mesmo navegador e o mesmo perfil.
- Em **Dados e backup**, escolha uma pasta do OneDrive: o app grava `bffx-dados.json` a cada alteração e uma cópia por dia em `historico/`.
- Para migrar do app antigo, use **Importar do app antigo → Buscar neste navegador** (ou o arquivo `bfmidi-backup.json`).

## Demonstração

**`BFX Technologies ERP (demonstração).html`** é o mesmo ERP com dados fictícios: três lotes de pedais, compras com NF-e (XML anexado), recebimento parcial, produção, custos, ajustes de estoque e uma contagem da transição MEI → ME. Serve para mostrar o sistema (ao contador, por exemplo) sem expor dados reais.

- Ela usa um banco separado no navegador (`bffx-erp-demo`) e não sincroniza com a pasta do OneDrive: nada do que se faz nela toca no ERP de verdade.
- A faixa do topo tem **Recomeçar**, que volta os dados ao original.
- O backup de demonstração é `erp/demo/backup-demonstracao.json`. Ele já vem embutido no arquivo de demonstração; também pode ser aberto em **Dados e backup → Restaurar backup** dentro da demonstração.
- Os CNPJs, notas e fornecedores marcados com "(exemplo)" são inventados.

## Usar em mais de um computador

Os computadores compartilham os dados pela mesma pasta do OneDrive, um de cada vez:

1. Copie `BFX Technologies ERP.html` para o outro computador e abra no Chrome ou no Edge.
2. Em **Dados e backup → Escolher pasta**, escolha a mesma pasta do OneDrive. Os dados são carregados sozinhos.
3. Ao trocar de computador, espere o OneDrive terminar de sincronizar.

Como funciona (`src/backup/sincronizacao.ts` e `src/backup/decisao.ts`):

- Cada gravação leva uma revisão nova, a revisão em que se baseou e o nome do computador.
- Ao abrir o app, ao voltar para ele e a cada 30 s, ele compara a revisão da pasta com a última que conhece: grava, carrega o que o outro computador mudou ou, se os dois mudaram, pergunta qual versão fica.
- Nada se perde: a versão descartada num conflito vai para `conflitos/`. Cópias extras criadas pelo OneDrive (`bffx-dados-NOMEDOPC.json`) também são detectadas.
- Um arquivo que não pode ser lido (por exemplo, no meio da sincronização do OneDrive) nunca é sobrescrito sozinho.

## Desenvolvimento

```bash
npm install
npm run dev        # servidor de desenvolvimento
npm test           # testes (vitest)
npm run build      # gera dist/index.html e copia para "../BFX Technologies ERP.html"
npm run demo:dados # refaz demo/backup-demonstracao.json com as regras do próprio ERP
npm run build:demo # gera a demonstração e copia para "../BFX Technologies ERP (demonstração).html"
```

Estrutura:

- `src/data/` — tipos, banco (Dexie), consultas das telas, ações que gravam (`acoes.ts`) e regras puras e testadas: estoque e custo médio (`estoque.ts`), compras e rateio (`compras.ts`), lotes e produção (`lotes.ts`), relatórios e pendências (`relatorios.ts`)
- `src/importacao/` — conversão dos dados do app antigo e leitura do XML da NF-e
- `src/backup/` — snapshot JSON, restauração e sincronização pela pasta
- `src/paginas/` — telas
- `src/ui/` — componentes visuais, formulários, gaveta lateral e rotas

Os nomes internos (`bffx-erp` no banco, `bffx-dados.json` na pasta) continuam os mesmos para não perder dados nem quebrar a sincronização. O esquema do banco não mudou: uma versão antiga do app aberta em outro computador continua sincronizando sem perder nada (só não mostra as telas novas).

## Plano

| Fase | Entrega | Situação |
|---|---|---|
| 0 | Fundação: banco, visual, backup automático, importação do app antigo | ✅ |
| 1 | Cadastros com campos fiscais (fornecedores, componentes, produtos e composição versionada) | ✅ |
| 2 | Estoque: livro de movimentações, ficha, ajustes, contagem física, saldo inicial da transição MEI → ME | ✅ |
| 3 | Compras: pedidos, recebimento, custo de chegada, XML da NF-e, CNPJ/CPF, anexos | ✅ |
| 4 | Planejamento de lotes e pedidos por fornecedor | ✅ |
| 5 | Produção e custos de fabricação, custo real por pedal | ✅ |
| 6 | Vendas (leve): estoque de produto acabado, XMLs de saída, faturamento 12 meses | |
| 7 | Relatórios para a contabilidade (fechamento mensal, inventário, PDF) | ✅ |
| 8 | Painel com pendências e atalhos; celular; se quiser, migração para online | Painel ✅ |
