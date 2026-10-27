# ERP_BFX

Sistema de gestão da **BFX Technologies** para a produção dos pedais BFMiDi: compras com NF-e, estoque com custo médio, lotes de produção, custo real por pedal e relatórios mensais para a contabilidade.

## Ver a demonstração online

**https://bffx-updates.github.io/ERP_BFX/** — o ERP com dados fictícios, direto no navegador. O que você mexer fica só no seu navegador.

## Abrir

Não precisa instalar nada: baixe e abra no **Chrome** ou no **Edge**.

| Arquivo | O que é |
|---|---|
| `BFX Technologies ERP.html` | O ERP. Os dados ficam no navegador e são sincronizados entre computadores por uma pasta do OneDrive. |
| `BFX Technologies ERP (demonstração).html` | O mesmo ERP com dados fictícios, num banco separado. Para mostrar o sistema sem tocar nos dados reais. |
| `erp/demo/backup-demonstracao.json` | O backup de demonstração (já embutido no arquivo acima). |

Nenhum dado real da empresa vai para este repositório: os dados ficam no navegador e na pasta do OneDrive.

## Pastas

- `erp/` — código-fonte (React, TypeScript, Dexie/IndexedDB, Vite), testes e a documentação completa em [`erp/README.md`](erp/README.md).
- `docs/` — a demonstração publicada no GitHub Pages.
- `index.html` — o app antigo de acompanhamento de compras dos pedais; o ERP importa os dados dele.
- `8SW.*`, `NANO.*`, `new visual/` — imagens e estudos visuais dos pedais.

## Desenvolvimento

```bash
cd erp
npm install
npm test
npm run build        # gera "BFX Technologies ERP.html"
npm run build:demo   # gera "BFX Technologies ERP (demonstração).html"
```
