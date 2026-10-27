// Versão de demonstração ("npm run build:demo"): banco separado do ERP de verdade, sem
// sincronização com a pasta, e com dados fictícios carregados na primeira vez que abre.
export const DEMO = import.meta.env.MODE === "demo";
