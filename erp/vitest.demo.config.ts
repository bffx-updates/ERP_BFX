import { defineConfig } from "vitest/config";

// Gera demo/backup-demonstracao.json com dados fictícios, usando as próprias regras do ERP.
// Rode "npm run demo:dados" e depois "npm run build:demo".
export default defineConfig({
  test: { environment: "node", include: ["demo/gerar-demo.ts"], testTimeout: 60000 },
});
